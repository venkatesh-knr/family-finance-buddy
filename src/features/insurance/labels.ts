import type { PolicyKind } from '../../repo/types.ts';

const LABELS: Record<PolicyKind, string> = {
  health: 'Health',
  term_life: 'Term life',
  endowment: 'Endowment',
  ulip: 'ULIP',
  money_back: 'Money-back',
  vehicle: 'Vehicle',
  home: 'Home',
  personal_accident: 'Personal accident',
  other: 'Other',
};

export function policyKindLabel(kind: PolicyKind): string {
  return LABELS[kind];
}

/** The kinds that have a surrender value, and so a holding to carry it (PF-C4). */
export const HYBRID_KINDS: readonly PolicyKind[] = ['endowment', 'ulip', 'money_back'];

export function isHybrid(kind: PolicyKind): boolean {
  return HYBRID_KINDS.includes(kind);
}
