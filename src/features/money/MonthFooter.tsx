/**
 * The foot of the Money month card (docs/drafts/month-actions.md; the MonthActions boards): under a hairline, *+ Money in* (an entry), *Accounts* (a place) and,
 * only when a month is waiting to be closed, *Close October* (a task) as the one primary, with the status line that says why beside it.
 *
 * The document order is the reading order: Money in, Accounts, the status, Close. The phone puts the status and Close first by reversing the column
 * in CSS, which moves nothing in the document (`.month-footer`). A closed month has its status line and no button.
 */

import type { ReactNode } from 'react';
import { monthWord } from './closeMonth.ts';
import type { MonthFooterStatus } from './monthFooter.ts';

export function MonthFooter({
  moneyIn,
  accounts,
  status,
  closeMonthKey,
  onClose,
}: {
  moneyIn: ReactNode;
  accounts: ReactNode;
  status: MonthFooterStatus;
  closeMonthKey: string;
  onClose: () => void;
}) {
  return (
    <div className="month-footer">
      <div className="month-footer-left">
        {moneyIn}
        {accounts}
      </div>
      {status !== null && (
        <div className="month-footer-right">
          <div className="month-footer-status">
            <span className="font-semibold">{status.title}</span>
            <span className="note">{status.sub}</span>
          </div>
          {(status.kind === 'ready' || (status.kind === 'waiting' && status.canClose)) && (
            <button type="button" className="btn month-close" onClick={onClose}>
              Close {monthWord(closeMonthKey)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
