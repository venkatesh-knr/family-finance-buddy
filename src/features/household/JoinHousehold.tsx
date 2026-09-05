/**
 * What an invited person sees before they belong to anything.
 *
 * This is the whole app for someone in that state, so it says what has happened
 * and what to do about it rather than reporting an error. "You are not a member
 * of any household" is true but useless on its own; the useful half is that
 * somebody has to give them a code.
 */

import { useCallback, useState } from 'react';
import { acceptInvite } from '../../repo/invites.ts';
import { Button, Card, Field, Problem } from '../../ui/primitives.tsx';

export function JoinHousehold({ onJoined }: { onJoined: () => void }) {
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setProblem(null);
      setBusy(true);
      try {
        await acceptInvite(code);
        onJoined();
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'That code was not accepted.');
      } finally {
        setBusy(false);
      }
    },
    [code, onJoined],
  );

  return (
    <Card title="Join a household">
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(event) => {
          void submit(event);
        }}
      >
        <p className="text-caption" style={{ color: 'var(--ink-2)' }}>
          This account is not in a household yet. An owner can issue you a ten-character invite
          code — enter it here and you are in.
        </p>

        <Field
          label="Invite code"
          numeric
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          maxLength={10}
          placeholder="XXXXXXXXXX"
          required
          value={code}
          onChange={(event) => {
            // Upper-cased as typed: the alphabet has no lower case, and a code
            // read off a phone screen should not fail for the shape of a letter.
            setCode(event.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''));
          }}
        />

        {problem !== null && <Problem>{problem}</Problem>}

        <Button type="submit" disabled={busy || code.length !== 10}>
          {busy ? 'Checking…' : 'Join'}
        </Button>

        <p className="note">
          Codes are single-use and expire. If yours has been used or has run out, ask for another —
          it cannot be looked up or extended, by anyone.
        </p>
      </form>
    </Card>
  );
}
