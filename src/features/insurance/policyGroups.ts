/**
 * How the policies are laid out on the Insurance screen: grouped as the board draws them, in force before lapsed,
 * and what the renewal pill says. Pure: the policies go in, a layout comes out.
 */

import type { RenewalDue } from '../../domain/protection.ts';
import type { InsurancePolicy, PolicyKind } from '../../repo/types.ts';
import { isHybrid } from './labels.ts';

export type PolicyGroupKey = 'life' | 'health' | 'surrender' | 'other';

export interface PolicyGroup {
  readonly key: PolicyGroupKey;
  readonly label: string;
  readonly policies: readonly InsurancePolicy[];
}

const LABELS: Record<PolicyGroupKey, string> = {
  life: 'Life',
  health: 'Health',
  surrender: 'With a surrender value',
  other: 'Other',
};

const ORDER: readonly PolicyGroupKey[] = ['life', 'health', 'surrender', 'other'];

/** Which group a kind sits in. A policy with a surrender value is a savings policy whatever else it covers. */
export function groupOf(kind: PolicyKind): PolicyGroupKey {
  if (isHybrid(kind)) return 'surrender';
  if (kind === 'term_life') return 'life';
  if (kind === 'health') return 'health';
  return 'other';
}

/** Only the groups that have a policy in them, in the board's order; within one, those in force first, otherwise as given. */
export function policyGroups(policies: readonly InsurancePolicy[]): readonly PolicyGroup[] {
  return ORDER.flatMap((key) => {
    const inGroup = policies.filter((policy) => groupOf(policy.kind) === key);
    if (inGroup.length === 0) return [];
    const ordered = [...inGroup.filter((policy) => !policy.isLapsed), ...inGroup.filter((policy) => policy.isLapsed)];
    return [{ key, label: LABELS[key], policies: ordered }];
  });
}

/** The pill beside a policy that is coming up for renewal, or past it. */
export function renewalPillText(due: Pick<RenewalDue, 'daysLeft' | 'overdue'>): string {
  if (due.overdue) return 'Renewal overdue';
  if (due.daysLeft === 0) return 'Renews today';
  return `Renews in ${String(due.daysLeft)} ${due.daysLeft === 1 ? 'day' : 'days'}`;
}
