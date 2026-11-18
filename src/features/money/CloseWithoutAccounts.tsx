/**
 * The close of a household with no accounts (docs/design/spending-capture.md section 11.3; the MonthCloseNoAccounts boards).
 *
 * Without an account there is no balance to close from, so the close asks what the month cost: the same linked fields as State the spend, with the month's
 * itemised figure to start from, and *Keep it itemised only* as a way out that is a choice. The itemised figure is read here for the month itself, as Last month
 * reads it: what was itemised, other members' private spending, less the refunds, in each currency. Until it is read there is no form, and a failed read says so
 * and writes nothing, since a total offered against a wrong itemised figure would put the wrong rest in the field.
 */

import { surfaceFigures } from './monthSurface.ts';
import { lastDayOf } from './closeMonth.ts';
import { StateSpend } from './StateSpend.tsx';
import { stateSpendChoices } from './stateSpendForm.ts';
import { useLastMonthSpend } from './useLastMonthSpend.ts';
import { useMonthTotals } from './useMonthTotals.ts';
import type { Member } from '../../repo/types.ts';
import { Stepper } from '../../ui/Stepper.tsx';
import { monthWord } from './closeMonth.ts';

export function CloseWithoutAccounts({
  householdId,
  month,
  members,
  currency,
  privacy,
  onDone,
  onCancel,
}: {
  householdId: string;
  /** The month, `YYYY-MM`. */
  month: string;
  members: readonly Member[];
  /** The currency read first. */
  currency: string;
  privacy: boolean;
  onDone: (said: string) => void;
  onCancel: () => void;
}) {
  const spend = useLastMonthSpend(householdId, month, members);
  const totals = useMonthTotals(householdId, `${month}-01`, lastDayOf(month), month);

  // Said in the form's own shell, on the screen the person is looking at, and never as a line at the top of the page they have scrolled away from.
  if (spend.status === 'failed' || totals.status === 'failed') {
    return (
      <Stepper
        title={`Close ${monthWord(month)}`}
        finishLabel={`Close ${monthWord(month)}`}
        problem={`What was itemised in ${monthWord(month)} could not be read just now, so the close is not offered and nothing was written. Go back and try again.`}
        onFinish={onCancel}
        onCancel={onCancel}
        steps={[{ name: 'What the month cost', ready: false, content: null }]}
      />
    );
  }
  if (spend.status !== 'ready' || totals.status !== 'ready') {
    return (
      <Stepper
        title={`Close ${monthWord(month)}`}
        finishLabel={`Close ${monthWord(month)}`}
        onFinish={onCancel}
        onCancel={onCancel}
        steps={[
          {
            name: 'What the month cost',
            ready: false,
            content: (
              <p className="note" role="status">
                Reading what was itemised in {monthWord(month)}…
              </p>
            ),
          },
        ]}
      />
    );
  }

  const figures = surfaceFigures({ totals: totals.totals, itemised: spend.itemised, privateSpend: spend.privateSpend, currency });
  return (
    <StateSpend
      variant="close"
      householdId={householdId}
      month={month}
      year={month.slice(0, 4)}
      currencies={stateSpendChoices({ reading: currency, itemisedIn: figures.spent.map((line) => line.currency), statedIn: [] })}
      itemised={figures.spent.map((line) => (line.minor < 0n ? { ...line, minor: 0n } : line))}
      privacy={privacy}
      onDone={onDone}
      onCancel={onCancel}
    />
  );
}
