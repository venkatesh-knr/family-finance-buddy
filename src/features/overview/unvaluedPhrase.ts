/**
 * "2 holdings have", "1 property has", "1 holding and 1 property have": what has never been valued, said as it is.
 *
 * A property is valued on its own screen and a holding on Holdings, so a sentence that sends somebody to record a
 * value has to say which it is counting. `unvalued` is the count of both together, as the totals make it; `properties`
 * is how many of those are property.
 */
export function unvaluedPhrase(unvalued: number, properties: number): string {
  const funds = unvalued - properties;
  const parts = [
    funds > 0 ? `${String(funds)} ${funds === 1 ? 'holding' : 'holdings'}` : null,
    properties > 0 ? `${String(properties)} ${properties === 1 ? 'property' : 'properties'}` : null,
  ].filter((part): part is string => part !== null);
  return `${parts.join(' and ')} ${unvalued === 1 ? 'has' : 'have'}`;
}
