/**
 * Read the descriptions out of a pgTAP file, and say whether that reading can be trusted.
 *
 * `check-invariants` counts a test as covering an invariant when the invariant's ID is in the test's
 * title. In TypeScript a title is a string argument and the compiler's own parser finds it. In SQL it
 * is the last argument of an assertion call, and finding it means reading SQL, which is where a
 * checker that guesses would count a comment, a fixture row or an error message as a test.
 *
 * So this does not guess. It tokenises the SQL properly (line and block comments, `'…'` with `''`
 * escapes, dollar-quoted bodies, quoted identifiers), finds top-level assertion calls, and then
 * **reconciles its own count against the file's `plan(N)`**. pgTAP itself fails a run whose number of
 * assertions differs from the plan, so the plan is an independent count of what the file contains. If
 * the two disagree, the reading is reported as unreliable and nothing in that file counts as coverage.
 * A reader that is wrong in a way the plan cannot see (a description taken from the wrong argument) is
 * the remaining gap, and is closed by taking a description only from the positions pgTAP's signatures
 * make unambiguous: where the position depends on argument types it takes none.
 */

/** Where the description sits for each assertion, by argument count. A missing entry means none or unknowable. */
const DESCRIPTION_AT = {
  // name: { argCount: indexOfDescription }
  ok: { 2: 1 },
  is: { 3: 2 },
  isnt: { 3: 2 },
  cmp_ok: { 4: 3 },
  matches: { 3: 2 },
  doesnt_match: { 3: 2 },
  lives_ok: { 2: 1 },
  // throws_ok(sql, errcode, errmsg, description): four arguments only. Three is ambiguous in pgTAP
  // itself (the third may be a message or a description, chosen by type), so it yields no description.
  throws_ok: { 4: 3 },
  throws_like: { 3: 2 },
  is_empty: { 2: 1 },
  isnt_empty: { 2: 1 },
  results_eq: { 3: 2 },
  results_ne: { 3: 2 },
  set_eq: { 3: 2 },
  bag_eq: { 3: 2 },
  set_has: { 3: 2 },
  set_hasnt: { 3: 2 },
  bag_has: { 3: 2 },
  bag_hasnt: { 3: 2 },
};

const ASSERTIONS = Object.keys(DESCRIPTION_AT);

/**
 * Split SQL into tokens: code, and the three kinds of string that must not be read as code.
 * Comments are dropped. Strings carry their decoded value.
 */
function tokenise(sql) {
  const tokens = [];
  let code = '';
  const flush = () => {
    if (code !== '') tokens.push({ kind: 'code', text: code });
    code = '';
  };
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);

    if (two === '--') {
      while (i < n && sql[i] !== '\n') i += 1;
      continue;
    }
    if (two === '/*') {
      // Block comments nest in PostgreSQL.
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql.slice(i, i + 2) === '/*') {
          depth += 1;
          i += 2;
        } else if (sql.slice(i, i + 2) === '*/') {
          depth -= 1;
          i += 2;
        } else i += 1;
      }
      continue;
    }
    if (c === "'") {
      flush();
      let value = '';
      i += 1;
      while (i < n) {
        if (sql[i] === "'" && sql[i + 1] === "'") {
          value += "'";
          i += 2;
        } else if (sql[i] === "'") {
          i += 1;
          break;
        } else {
          value += sql[i];
          i += 1;
        }
      }
      tokens.push({ kind: 'string', value });
      continue;
    }
    if (c === '"') {
      // A quoted identifier is code that happens to contain odd characters.
      let j = i + 1;
      while (j < n && !(sql[j] === '"' && sql[j + 1] !== '"')) j += sql[j] === '"' ? 2 : 1;
      code += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z_0-9]*)?\$/.exec(sql.slice(i));
      if (m !== null) {
        flush();
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end;
        tokens.push({ kind: 'dollar', value: sql.slice(i + tag.length, stop) });
        i = end === -1 ? n : end + tag.length;
        continue;
      }
    }
    code += c;
    i += 1;
  }
  flush();
  return tokens;
}

/** Statements, each as masked text (strings replaced by \u0001n\u0001) plus the string table. */
export function statements(sql) {
  const out = [];
  let masked = '';
  let strings = [];
  const finish = () => {
    if (masked.trim() !== '') out.push({ masked, strings });
    masked = '';
    strings = [];
  };
  for (const t of tokenise(sql)) {
    if (t.kind === 'code') {
      const parts = t.text.split(';');
      parts.forEach((part, idx) => {
        masked += part;
        if (idx < parts.length - 1) finish();
      });
    } else {
      masked += `\u0001${String(strings.length)}\u0001`;
      strings.push({ kind: t.kind, value: t.value });
    }
  }
  finish();
  return out;
}

/** The arguments of the call that opens at `start` (the index of its "("), split on top-level commas. */
function argumentsOf(masked, start) {
  let depth = 0;
  let current = '';
  const args = [];
  for (let i = start; i < masked.length; i += 1) {
    const c = masked[i];
    if (c === '(') {
      depth += 1;
      if (depth === 1) continue;
    } else if (c === ')') {
      depth -= 1;
      if (depth === 0) {
        if (current.trim() !== '' || args.length > 0) args.push(current.trim());
        return args;
      }
    } else if (c === ',' && depth === 1) {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += c;
  }
  return null; // unbalanced: not a call this reader understands
}

/** The assertion a statement's own (depth-zero) select calls, if it does: its name and where its `(` is. */
function topLevelAssertion(masked) {
  if (!/^\s*(select|with)\b/i.test(masked)) return null;
  const re = new RegExp(`\\bselect\\s+(${ASSERTIONS.join('|')})\\s*\\(`, 'gi');
  let depth = 0;
  let scanned = 0;
  for (const m of masked.matchAll(re)) {
    for (let i = scanned; i < m.index; i += 1) {
      if (masked[i] === '(') depth += 1;
      else if (masked[i] === ')') depth -= 1;
    }
    scanned = m.index;
    if (depth === 0) return { name: m[1].toLowerCase(), open: m.index + m[0].length - 1 };
  }
  return null;
}

/** A single-quoted string, optionally cast, and nothing else: the only shape a description takes. */
function literalOf(arg, strings) {
  const m = /^\u0001(\d+)\u0001(?:\s*::\s*[A-Za-z_][A-Za-z_0-9 ]*(?:\(\s*\d+\s*\))?)?$/.exec(arg);
  if (m === null) return null;
  const s = strings[Number(m[1])];
  return s !== undefined && s.kind === 'string' ? s.value : null;
}

/**
 * Read one pgTAP file.
 * @returns {{ plan: number | null, assertions: number, titles: string[], reliable: boolean, why: string | null }}
 */
export function readPgTap(sql) {
  let plan = null;
  let assertions = 0;
  const titles = [];
  let noPlan = false;

  for (const { masked, strings } of statements(sql)) {
    if (/\bno_plan\s*\(/i.test(masked)) noPlan = true;
    const planCall = /^\s*select\s+plan\s*\(\s*(\d+)\s*\)\s*$/i.exec(masked);
    if (planCall !== null) {
      plan = Number(planCall[1]);
      continue;
    }
    // A statement is an assertion when its top-level select is `select name(...)`. That is the whole
    // statement, or what follows a `with` clause: the suites check what a denied write did by running
    // it in a CTE and asserting on the result, and an assertion there is still one assertion.
    const found = topLevelAssertion(masked);
    if (found === null) continue;
    const { name, open } = found;
    const args = argumentsOf(masked, open);
    if (args === null) continue;
    // Anything after the closing parenthesis (a `from`, a `union`) means more than one assertion may be
    // produced by the statement, which is the case the plan count exists to catch.
    assertions += 1;
    const at = DESCRIPTION_AT[name]?.[args.length];
    if (at === undefined) continue;
    const text = literalOf(args[at] ?? '', strings);
    if (text !== null) titles.push(text);
  }

  if (noPlan) return { plan, assertions, titles, reliable: false, why: 'the file uses no_plan(), so its count cannot be checked' };
  if (plan === null) return { plan, assertions, titles, reliable: false, why: 'the file has no `select plan(N)`' };
  if (plan !== assertions) {
    return {
      plan,
      assertions,
      titles,
      reliable: false,
      why: `read ${String(assertions)} assertions where plan(${String(plan)}) says there are ${String(plan)}`,
    };
  }
  return { plan, assertions, titles, reliable: true, why: null };
}
