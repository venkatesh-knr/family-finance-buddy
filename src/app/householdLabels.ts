/**
 * What each household is called in the switcher, so no two read alike.
 *
 * The switcher offered three options that all read "Demo household (demo)".
 * Somebody switching was choosing blind, and the badge that exists so there is
 * "never a moment of wondering which numbers you are looking at" cannot do that
 * when every option wears it. Names are chosen by whoever created the household
 * and nothing makes them unique, so the label is made distinguishable here.
 *
 * Only a name that is repeated is touched; the others read as they are. A repeated
 * name gets the least that tells its group apart, in this order: the role the
 * person has in each, the date each was created, a short piece of its id. The last
 * always works, which is why it is last: a label that is a bare hex string is
 * accurate and no use to anybody, and the first two are what a person recognises.
 *
 * This does not decide which households should exist. Renaming or removing the
 * extra ones is a change to the data, and is the maintainer's.
 *
 * Pure.
 */

import { formatIsoDate } from '../lib/dates.ts';

export interface LabelledMembership {
  readonly household: {
    readonly id: string;
    readonly name: string;
    /** The calendar date it was created, in IST, when known. */
    readonly createdOn: string | null;
  };
  readonly role: string;
}

const key = (name: string): string => name.trim().toLowerCase();

export function householdLabels(memberships: readonly LabelledMembership[]): ReadonlyMap<string, string> {
  const groups = new Map<string, LabelledMembership[]>();
  for (const membership of memberships) {
    const k = key(membership.household.name);
    groups.set(k, [...(groups.get(k) ?? []), membership]);
  }

  const labels = new Map<string, string>();
  for (const group of groups.values()) {
    const first = group[0];
    if (first === undefined) continue;

    if (group.length === 1) {
      labels.set(first.household.id, first.household.name.trim());
      continue;
    }

    const distinct = (values: readonly (string | null)[]): boolean =>
      values.every((v) => v !== null) && new Set(values).size === values.length;

    const roles = group.map((g) => g.role);
    const dates = group.map((g) => g.household.createdOn);

    let suffixes: string[];
    if (distinct(roles)) {
      suffixes = roles;
    } else if (distinct(dates)) {
      suffixes = dates.map((d) => `created ${formatIsoDate(d as string)}`);
    } else {
      let length = 4;
      let ids = group.map((g) => g.household.id.slice(0, length));
      while (new Set(ids).size < ids.length && length < 36) {
        length += 2;
        ids = group.map((g) => g.household.id.slice(0, length));
      }
      suffixes = ids;
    }

    group.forEach((g, i) => {
      labels.set(g.household.id, `${g.household.name.trim()} · ${suffixes[i] ?? ''}`);
    });
  }
  return labels;
}
