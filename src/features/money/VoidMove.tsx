/**
 * Void a move between the household's own accounts (docs/design/ledger-income.md sections 1 and 12; LI-I2).
 *
 * A move is neither came in nor spent, and a wrong one is voided and not edited: it stops counting and stays in the list, marked. One short
 * form that says which move it is and asks before it writes.
 */

import { useState } from 'react';
import { voidTransfer } from '../../repo/transfers.ts';
import { Stepper } from '../../ui/Stepper.tsx';
import type { LedgerLine } from './ledgerLines.ts';

export function VoidMove({ id, line, onDone, onCancel }: { id: string; line: LedgerLine; onDone: (said: string) => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const finish = async (): Promise<void> => {
    setBusy(true);
    setProblem(null);
    try {
      await voidTransfer(id);
      onDone('Move voided. It no longer counts.');
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'That could not be voided.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stepper
      title="A move between accounts"
      finishLabel="Void this move"
      busyLabel="Voiding…"
      busy={busy}
      problem={problem}
      onCancel={onCancel}
      onFinish={finish}
      steps={[
        {
          name: line.title,
          ready: true,
          content: (
            <>
              <p>
                <span className="recent-payee block">{line.title}</span>
                <span className="note block">{line.sub}</span>
                <span className="tabular-nums block">{line.amount}</span>
                <span className="note block">{line.word}</span>
              </p>
              <p className="note">
                Void it if it should not have been entered. It stops counting and stays in the list, marked voided. A move is not edited: void it and enter
                the right one.
              </p>
            </>
          ),
        },
      ]}
    />
  );
}
