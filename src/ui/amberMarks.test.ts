import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Amber is for attention, and attention means the person can do something (docs/tokens.md §2, "A caveat mark is amber only while the person
 * can do something about it": an incomplete or caveated figure takes the muted ⓘ, and the amber `!` is for one they can
 * act on).
 *
 * This is the census of every amber mark on Overview, Holdings and FIRE, and it is the classification the
 * owner asked for written down where it can fail. A mark is amber only if its text tells the person what to
 * do. A new amber mark fails this test until it is listed here with the action it names, which is the point:
 * the call whether a caveat deserves amber is made on purpose and not by whichever tone a component reached for.
 */

const DIRS = ['src/features/overview', 'src/features/holdings', 'src/features/plan'];

/** What a person can do, as the verb the sentence starts with. */
const ACTION = /\b(Record|Import|Reload|reload|Close)\b|IMPORT_THE_FULL_STATEMENT|RECORD_THE_COST|heroWarnings/;

interface Mark {
  readonly file: string;
  readonly label: string;
  readonly tone: string;
  readonly body: string;
}

function marks(): Mark[] {
  const found: Mark[] = [];
  for (const dir of DIRS) {
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.tsx'))) {
      const source = readFileSync(join(dir, name), 'utf8');
      // An opening tag runs to the first `>` that is not inside braces: a tone can be a comparison.
      for (const m of source.matchAll(/<Caveat\b((?:[^>{]|\{[^}]*\})*)>([\s\S]*?)<\/Caveat>/g)) {
        const tag = m[1] ?? '';
        const tone = /tone=("[a-z]+"|\{[^}]*\})/.exec(tag)?.[1] ?? 'info';
        const label = /label=("[^"]*"|\{`[^`]*`\}|\{[^}]*\})/.exec(tag)?.[1] ?? '';
        found.push({ file: `${dir}/${name}`, label, tone, body: m[2] ?? '' });
      }
    }
  }
  return found;
}

/** Every amber mark, by file and label, and the action it names. The classification. */
const AMBER: Record<string, string> = {
  'src/features/overview/OverviewScreen.tsx|"Why this figure may be wrong"': 'amber only while a reason can be acted on: record a value, record the balance, or reload',
  'src/features/overview/OverviewScreen.tsx|"Why these do not add into one figure"': 'record the rate that is missing, or reload',
  'src/features/overview/OverviewScreen.tsx|{`Why this ${total.currency} total is short`}': 'record a value on Holdings',
  'src/features/overview/OverviewScreen.tsx|{`Why this ${total.currency} cost is short`}': 'import the full statement, or record the cost',
  'src/features/overview/OverviewScreen.tsx|{`Why there is no return for ${kindLabel(row.kind)}`}': 'import the full statement, or record the cost',
  'src/features/holdings/HoldingsList.tsx|"How these totals are put together"': 'amber only when the paid-out read failed: reload',
  'src/features/holdings/HoldingsList.tsx|{`Why this ${lead.currency} total is short`}': 'record a value on the holding',
  'src/features/holdings/HoldingsList.tsx|{`Why this ${mine.currency} cost is short`}': 'import the full statement, or record the cost',
  "src/features/holdings/HoldingsList.tsx|{gain.short ? 'Why there is no return for this holding' : 'Why there is no cost for this holding'}": 'import the full statement, or record the cost',
  'src/features/holdings/HoldingDetail.tsx|{`Why this ${String(peak.year)} peak is a lower bound`}': 'record a reading for each missing month',
  'src/features/holdings/CostAndGains.tsx|"Why this cost covers only part of the units"': 'import the full statement',
  'src/features/holdings/CostAndGains.tsx|"Why part of a sale is missing from this figure"': 'record the purchases the sale was made from',
  'src/features/holdings/FixedIncome.tsx|"What this total contains"': 'amber only while a renewal is unrecorded: record it on its row',
  'src/features/plan/FireReadout.tsx|"Why this figure may be wrong"': 'amber only while a reason can be acted on, as on the Overview',
};

/** Marks that are about what a figure leaves out and not about something to do: grey, always. */
const ALWAYS_GREY = [
  'src/features/overview/OverviewScreen.tsx|{privateLeftOut ? \'What these totals leave out\' : \'How these totals are put together\'}',
  'src/features/overview/OverviewScreen.tsx|"What these shares are of"',
];

describe('every amber mark on Overview, Holdings and FIRE says what to do', () => {
  const all = marks();
  const amber = all.filter((m) => m.tone.includes('warn'));

  it('finds the marks it is meant to classify', () => {
    expect(all.length).toBeGreaterThan(15);
  });

  it('has exactly the amber marks that are listed, so a new one is a decision', () => {
    const present = amber.map((m) => `${m.file}|${m.label}`).sort();
    expect(present).toEqual(Object.keys(AMBER).sort());
  });

  it.each(amber.map((m) => [`${m.file}|${m.label}`, m] as const))('names an action: %s', (_key, mark) => {
    expect(mark.body).toMatch(ACTION);
  });

  it.each(ALWAYS_GREY)('stays grey: %s', (key) => {
    const mark = all.find((m) => `${m.file}|${m.label}` === key);
    expect(mark, key).toBeDefined();
    expect(mark?.tone).not.toMatch(/warn/);
  });
});

describe("the hero's reasons: the amber mark is earned by a reason that names something to do", () => {
  const hook = readFileSync('src/features/overview/useOverviewData.ts', 'utf8');
  const settings = [...hook.matchAll(/heroActionable = true; \/\/ ([a-z ]+)/g)].map((m) => m[1]);

  it("sets it only for reasons that name a reload or a record, and not for the ones that are somebody else's to act on", () => {
    expect(settings).toEqual(['reload', 'record a value', 'record the balance', 'reload']);
  });
});
