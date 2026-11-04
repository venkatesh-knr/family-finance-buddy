/**
 * The recurring entries that have come due are made when an owner or a partner opens the app (docs/design/spending-capture.md
 * section 3). There is no scheduler of our own and none planned, so this is the poster: once for each household a page load shows, it asks
 * the database to enter every due day up to today, once per due date (SC-I10). Opening the app on two devices makes the entries once.
 *
 * It says how many it made, so the screen showing entries can read again. A failure leaves the rule's next due day in the past, which
 * the Settings section shows as not yet entered.
 */

import { useEffect, useRef, useState } from 'react';
import { postDueRecurring } from '../repo/recurring.ts';

export function usePostRecurring(householdId: string | null, role: string | null): number {
  const [made, setMade] = useState(0);
  const done = useRef(new Set<string>());

  useEffect(() => {
    if (householdId === null || (role !== 'owner' && role !== 'partner')) return;
    if (done.current.has(householdId)) return;
    done.current.add(householdId);
    void postDueRecurring(householdId)
      .then((count) => {
        if (count > 0) setMade((total) => total + count);
      })
      .catch(() => {
        // Let the next time the app is opened try again.
        done.current.delete(householdId);
      });
  }, [householdId, role]);

  return made;
}
