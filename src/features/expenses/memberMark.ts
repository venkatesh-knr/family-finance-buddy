/**
 * What to print in a member's mark.
 *
 * The way a chat app does it: the first letter of the first name and of the
 * last, so "Venkatesh Nair" is VN and "Meera Rao" is MR. A name of one word is
 * its initial. A note in brackets is not part of a name ("Priya (left Mar 2026)"
 * is Priya) and is ignored.
 *
 * Where two members come out the same, the ones that collide fall back to the
 * first two letters of the first name (Ve, Vi), and only where that fails too is
 * the name shown beside the mark, for those members alone.
 *
 * Computed across every member of the household, archived included: an entry
 * from somebody who has left is still on the ledger.
 */

export interface MarkMember {
  readonly id: string;
  readonly displayName: string;
}

export interface MemberMark {
  readonly text: string;
  /** True where letters cannot tell this member from another. */
  readonly showName: boolean;
}

function words(name: string): string[] {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .split(/\s+/)
    .filter((w) => w !== '');
}

const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();

/** VN for two words or more, V for one, ? for none. */
function initials(name: string): string {
  const w = words(name);
  const first = w[0];
  const last = w[w.length - 1];
  if (first === undefined || last === undefined) return '?';
  return w.length === 1
    ? first.charAt(0).toUpperCase()
    : first.charAt(0).toUpperCase() + last.charAt(0).toUpperCase();
}

/** Ve, from the first two letters of the first name. */
function prefix(name: string): string {
  const first = words(name)[0];
  return first === undefined ? '?' : cap(first.slice(0, 2));
}

export function memberMarks(members: readonly MarkMember[]): ReadonlyMap<string, MemberMark> {
  const count = (values: readonly string[]): Map<string, number> => {
    const seen = new Map<string, number>();
    for (const v of values) seen.set(v.toUpperCase(), (seen.get(v.toUpperCase()) ?? 0) + 1);
    return seen;
  };

  const base = new Map(members.map((m) => [m.id, initials(m.displayName)] as const));
  const baseCount = count([...base.values()]);

  // Everybody's second try, or their first if it was already unique.
  const second = new Map(
    members.map((m) => {
      const b = base.get(m.id) ?? '?';
      return [m.id, (baseCount.get(b.toUpperCase()) ?? 0) === 1 ? b : prefix(m.displayName)] as const;
    }),
  );
  const secondCount = count([...second.values()]);

  const marks = new Map<string, MemberMark>();
  for (const m of members) {
    const text = second.get(m.id) ?? '?';
    marks.set(
      m.id,
      (secondCount.get(text.toUpperCase()) ?? 0) === 1
        ? { text, showName: false }
        : { text: base.get(m.id) ?? '?', showName: true },
    );
  }
  return marks;
}
