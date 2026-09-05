/**
 * Sign in — password, then an authenticator code. Always both.
 *
 * There is no link to a sign-up form anywhere on this screen, because there is
 * no sign-up form: accounts exist only by accepting an invite, and the backend
 * has public registration disabled. A stranger who finds the URL sees this and
 * can get no further.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  beginTotpEnrolment,
  signInWithPassword,
  signOut,
  verifyTotpCode,
  type AuthStage,
  type TotpEnrolment,
} from '../../repo/auth.ts';
import { createAccountFromInvite } from '../../repo/invites.ts';
import { Button, Card, Field, PasswordField, Problem } from '../../ui/primitives.tsx';

export function SignInScreen({ stage, email }: { stage: AuthStage; email: string | null }) {
  if (stage === 'needs-totp-enrolment') return <EnrolTotp email={email} />;
  if (stage === 'needs-totp-code') return <PresentCode email={email} />;
  return <PasswordForm />;
}

function Frame({ title, blurb, children }: { title: string; blurb: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-[420px] flex-col justify-center gap-4.5 px-4.5 py-11">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-title">Finance Buddy</h1>
        <p className="note">{blurb}</p>
      </div>
      <Card title={title}>{children}</Card>
    </main>
  );
}

function PasswordForm() {
  const [redeeming, setRedeeming] = useState(false);
  if (redeeming) {
    return (
      <RedeemInvite
        onDone={() => {
          setRedeeming(false);
        }}
      />
    );
  }
  return <SignInForm onRedeem={() => { setRedeeming(true); }} />;
}

function SignInForm({ onRedeem }: { onRedeem: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setProblem(null);
      try {
        await signInWithPassword(email.trim(), password);
        // The auth subscription in App re-reads the stage from here.
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Sign-in failed.');
      } finally {
        setBusy(false);
      }
    },
    [email, password],
  );

  return (
    <Frame title="Sign in" blurb="Accounts here are created by invitation only.">
      <form className="flex flex-col gap-3.5" onSubmit={(event) => void submit(event)}>
        <Field
          label="Email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />
        {problem !== null && <Problem>{problem}</Problem>}
        <Button type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Continue'}
        </Button>
        <p className="note">
          You will be asked for a code from your authenticator app next. Every account on this
          system has one.
        </p>

        <button type="button" className="note self-start underline" onClick={onRedeem}>
          I have an invite code and no account yet
        </button>
      </form>
    </Frame>
  );
}

/**
 * Create an account from an invite code.
 *
 * This has to live on the sign-in screen rather than behind it: someone holding
 * a code has no account, so every other screen is out of reach. It is the one
 * route into this system that does not start with an account already existing.
 */
function RedeemInvite({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setProblem(null);
      setBusy(true);
      try {
        await createAccountFromInvite({ code, email, password });
        setDone(true);
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Could not create the account.');
      } finally {
        setBusy(false);
      }
    },
    [code, email, password],
  );

  if (done) {
    return (
      <Frame title="Account created" blurb="One more step.">
        <div className="flex flex-col gap-3.5">
          <p className="text-caption" style={{ color: 'var(--ink-2)' }}>
            You are in the household. Sign in with the address and password you just chose — you
            will then set up an authenticator app, which every account here has.
          </p>
          <Button type="button" onClick={onDone}>
            Sign in
          </Button>
        </div>
      </Frame>
    );
  }

  return (
    <Frame title="Use an invite code" blurb="This is how an account is created here.">
      <form className="flex flex-col gap-3.5" onSubmit={(event) => void submit(event)}>
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
            setCode(event.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''));
          }}
        />
        <Field
          label="Your email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <PasswordField
          label="Choose a password"
          autoComplete="new-password"
          required
          hint="At least 12 characters. A passphrase of a few words is easier to remember and harder to guess."
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
          }}
        />

        {problem !== null && <Problem>{problem}</Problem>}

        <Button type="submit" disabled={busy || code.length !== 10 || password.length < 12}>
          {busy ? 'Creating…' : 'Create my account'}
        </Button>

        <button type="button" className="note self-start underline" onClick={onDone}>
          Back to sign in
        </button>
      </form>
    </Frame>
  );
}

function EnrolTotp({ email }: { email: string | null }) {
  const [enrolment, setEnrolment] = useState<TotpEnrolment | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const started = await beginTotpEnrolment();
        if (!cancelled) setEnrolment(started);
      } catch (error) {
        if (!cancelled) setProblem(error instanceof Error ? error.message : 'Could not start enrolment.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Frame
      title="Set up your authenticator"
      blurb={email === null ? 'One step left.' : `Signed in as ${email}. One step left.`}
    >
      <div className="flex flex-col gap-3.5">
        <p className="text-caption">
          Scan this with an authenticator app — 1Password, Aegis, Google Authenticator, whichever
          you use. A password alone reads nothing here, so this is not optional.
        </p>

        {problem !== null && <Problem>{problem}</Problem>}

        {enrolment === null ? (
          <p className="note">Preparing…</p>
        ) : (
          <>
            <div
              className="mx-auto rounded bg-white p-3"
              // The SVG comes from our own auth server over TLS. It is markup,
              // not an image request, so it needs no img-src allowance.
              dangerouslySetInnerHTML={{ __html: enrolment.qrCodeSvg }}
            />
            <div className="flex flex-col gap-1.5">
              <span className="micro-label">Or type this in</span>
              <code className="num scroll-x rounded bg-s2 px-2.5 py-2 text-cell">
                {enrolment.secret}
              </code>
            </div>
            <CodeForm factorId={enrolment.factorId} submitLabel="Confirm and finish" />
          </>
        )}

        <SignOutLink />
      </div>
    </Frame>
  );
}

function PresentCode({ email }: { email: string | null }) {
  return (
    <Frame
      title="Authenticator code"
      blurb={email === null ? 'Second step.' : `Signed in as ${email}. Second step.`}
    >
      <div className="flex flex-col gap-3.5">
        <CodeForm submitLabel="Sign in" />
        <SignOutLink />
      </div>
    </Frame>
  );
}

function CodeForm({ factorId, submitLabel }: { factorId?: string; submitLabel: string }) {
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setBusy(true);
      setProblem(null);
      try {
        await verifyTotpCode(code, factorId);
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'That code was not accepted.');
      } finally {
        setBusy(false);
      }
    },
    [code, factorId],
  );

  return (
    <form className="flex flex-col gap-3.5" onSubmit={(event) => void submit(event)}>
      <Field
        label="Six-digit code"
        numeric
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        maxLength={6}
        required
        value={code}
        onChange={(event) => {
          setCode(event.target.value.replace(/\D/g, ''));
        }}
      />
      {problem !== null && <Problem>{problem}</Problem>}
      <Button type="submit" disabled={busy || code.length !== 6}>
        {busy ? 'Checking…' : submitLabel}
      </Button>
    </form>
  );
}

function SignOutLink() {
  return (
    <button
      type="button"
      className="note self-start underline"
      onClick={() => {
        void signOut();
      }}
    >
      Sign out and start again
    </button>
  );
}
