/**
 * What to print in a member's mark.
 *
 * The initial, when it is enough. Where two members of a household start with
 * the same letter the letter no longer says who, and printing every name again
 * would undo the point of a mark, so the ones that collide grow to two letters
 * (Ve, Vi) and the rest keep one. Where two letters still do not separate them
 * (Vinay, Vinita) or the names are identical, the name is shown beside the
 * initial for those members, which is the one case it has to be.
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

export function memberMarks(members: readonly MarkMember[]): ReadonlyMap<string, MemberMark> {
  const chars = (name: string, n: number): string => name.trim().slice(0, n).toUpperCase();
  const count = (values: readonly string[]): Map<string, number> => {
    const seen = new Map<string, number>();
    for (const v of values) seen.set(v, (seen.get(v) ?? 0) + 1);
    return seen;
  };

  const one = count(members.map((x) => chars(x.displayName, 1)));
  const two = count(members.map((x) => chars(x.displayName, 2)));

  const marks = new Map<string, MemberMark>();
  for (const member of members) {
    const first = chars(member.displayName, 1);
    if (first === '') {
      marks.set(member.id, { text: '?', showName: false });
    } else if ((one.get(first) ?? 0) === 1) {
      marks.set(member.id, { text: first, showName: false });
    } else {
      const both = chars(member.displayName, 2);
      marks.set(
        member.id,
        (two.get(both) ?? 0) === 1 && both.length === 2
          ? { text: member.displayName.trim().slice(0, 1).toUpperCase() + member.displayName.trim().slice(1, 2).toLowerCase(), showName: false }
          : { text: first, showName: true },
      );
    }
  }
  return marks;
}
