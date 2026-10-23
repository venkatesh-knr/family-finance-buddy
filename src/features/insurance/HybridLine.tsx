import { money } from '../../lib/money.ts';
import { Amount } from '../../ui/primitives.tsx';
import type { PolicyFacts } from './insuranceFacts.ts';

/** What has been paid in against what it would pay out today: both facts, set side by side and not editorialised. */
export function HybridLine({ facts, privacy }: { facts: PolicyFacts; privacy: boolean }) {
  if (facts.paidIn === null || facts.surrenderValue === null || facts.behind === null) {
    return (
      <p className="note policy-hybrid">
        {facts.surrenderValue === null
          ? 'The holding that carries its surrender value has not been valued yet.'
          : 'Add when the policy started and its premium to see what has fallen due.'}
      </p>
    );
  }
  const behind = facts.behind.minor;
  return (
    <p className="note policy-hybrid" data-testid="surrender-gap">
      Premiums due so far <Amount value={facts.paidIn} privacy={privacy} compact /> (counted from when it began, and
      stopping at a lapse or the end of the premium term, so it is what fell due and not a record of what was paid); it
      would pay out <Amount value={facts.surrenderValue} privacy={privacy} compact /> today
      {behind > 0n ? (
        <>
          : the household is <Amount value={facts.behind} privacy={privacy} compact /> behind the premiums that have
          fallen due.
        </>
      ) : (
        <>
          : <Amount value={money(-behind, facts.behind.currency)} privacy={privacy} compact /> ahead of the premiums
          that have fallen due.
        </>
      )}
    </p>
  );
}
