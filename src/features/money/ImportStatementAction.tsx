/**
 * The *Import a statement* button on the Money screen's month card, and the flow it opens (docs/design/spending-capture.md section 3; docs/build-plan.md step 7).
 *
 * Shown only to someone who can record: a viewer sees none. It sits with *+ Money in*, since both bring money's movements in. After an import it says what was written, in the screen's
 * status line, and the entries are read again.
 */

import { useState } from 'react';
import { ImportStatement } from './ImportStatement.tsx';
import type { AccountsData } from './useAccounts.ts';

export function ImportStatementAction({ data, privacy, onSaid, onImported }: { data: AccountsData | null; privacy: boolean; onSaid: (message: string) => void; onImported: () => void }) {
  const [open, setOpen] = useState(false);
  if (data === null || !data.viewer.canRecord) return null;
  return (
    <>
      <button
        type="button"
        className="btn btn-quiet"
        onClick={() => {
          setOpen(true);
        }}
      >
        Import a statement
      </button>
      {open && (
        <ImportStatement
          data={data}
          privacy={privacy}
          onDone={(said) => {
            setOpen(false);
            onSaid(said);
            onImported();
          }}
          onCancel={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
