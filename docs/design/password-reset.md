# Forgot password: getting back in when the password is lost

<!-- invariant-prefix: PW -->

Design only, 26 November 2026. **Nothing here is built, and nothing is applied to the live project.** Every change to another
document is listed in §10 as an exact edit, and each one is **proposed**. The questions in §11 are the owner's.

## 0. Status

The sign-in screen asks for an email and a password, then an authenticator code, always both (`SignInScreen.tsx`,
`src/repo/auth.ts`). A signed-in person can change their password (`changePassword`). A person who has **forgotten** it has no
way back in: there is no link on the screen, and nobody else can set it for them, because no screen or account has that power (the
blueprint's layer 11: no superuser).

This document is the design of that one way back, and nothing more. It does not touch a lost authenticator (§2).

## 1. What a person sees

1. On *Sign in*, under the password, a quiet link: **Forgot your password?**
2. It opens a screen with one field, *Email*, and a button, *Send me a link*.
3. Whatever was typed, the screen then says the same thing: *If that address has an account here, a link is on its way. It works
   once, for an hour. Check your spam folder if it does not come.* (PW-I1)
4. The email has one button, *Choose a new password*, and no figures, no household name and no member names. (PW-I7)
5. The link opens the app on a screen called *Choose a new password*, with the same two fields and rules as the change-password form,
   and nothing else on the page: no menu, no household. (PW-I4)
6. After saving, the app says *Your password is changed. Sign in with it now.* and ends the session it was using. The person signs in
   as usual, with the new password, **and then the authenticator code**. (PW-I2)

## 2. What it is not

- **Not a way to skip the authenticator.** Two-step sign-in is mandatory on every account (blueprint layer 04). A reset replaces the
  password only. A mailbox that is broken into can therefore set a password and still read nothing, because the code on the
  person's phone is a separate secret. This is the blueprint's own reasoning: *email one-time codes belong in recovery, and their
  strength is the strength of the mailbox behind them* (layer 04, layer 10).
- **Not a way to remove or replace the authenticator.** A person who has lost the phone as well is not helped by this screen, and
  the screen does not pretend to help: it offers no *I lost my authenticator* link. That path (recovery codes issued at enrolment,
  and an owner who re-invites) is blueprint layer 10, is not built, and is the next slice (§9, slice 3). (PW-I10)
- **Not a sign-up.** The link works only for an address that already has an account. An invite is still the only way to create one,
  and public sign-up stays off at the project (PW-I8).
- **Not a new place for email to come from.** The app's own code sends no email. The auth provider sends this one (PW-I7).

## 3. How it works

### 3.1 The calls

| Step | Call | What it does |
| --- | --- | --- |
| Request | `auth.resetPasswordForEmail(email, { redirectTo })` | The provider emails a link, if the address has an account. It answers the same either way. |
| Arrive | `auth.exchangeCodeForSession(code)` | The link's single-use code becomes a short **recovery session**. |
| Choose | `auth.updateUser({ password })` | Sets the new password. The same function as `changePassword`. |
| Leave | `auth.signOut({ scope: 'global' })` | Ends every session the account has, the recovery one and any other (PW-I6). |

### 3.2 Four things in this project that decide the build

1. **The code is in the query string, and the app routes on the hash.** The client already uses the PKCE flow
   (`flowType: 'pkce'`) and has `detectSessionInUrl: false` (`src/repo/client.ts`), so the link arrives as
   `https://<the site>/?code=…#/…`. The app must read `code` **before** the router starts, exchange it once, and remove it from the
   address bar (`history.replaceState`), so that it is not kept in the browser's history, not sent in a referrer and not copied from
   the address bar. (PW-I3) This is the part most likely to go wrong and is the first thing to build (§9, slice 1).
2. **A recovery session must not be treated as a sign-in.** The app's stages are *signed out*, *needs a code*, *needs enrolment*
   and *signed in* (`AuthStage`). A recovery session is a fifth state: it has proved the mailbox and nothing else. It reaches the
   *Choose a new password* screen and no other, and no household query is made while it exists (PW-I4). The provider emits a
   `PASSWORD_RECOVERY` event for it, which the existing auth subscription (`subscribeToAuth`) must see and map.
3. **An account that has an authenticator may be refused a password change from a session that has not passed it.** The provider
   can require the second factor before `updateUser` changes a password on an account with one enrolled. If it does, the reset
   must still work, so the *Choose a new password* screen would first ask for the authenticator code, and the reset would then
   need **both** the mailbox and the phone. That is stricter than §1 and acceptable, but it changes the screens, so it is settled by
   a **spike** against the live project before slice 2 (§9, slice 1), not assumed. Whichever it is, PW-I2 holds.
4. **Email has to arrive.** The provider's built-in sender is for trying things out: it is limited to a handful of messages an hour
   for the whole project and may deliver only to the project's own team. A household cannot depend on it. Real delivery needs the
   project's own SMTP sender and, for the mail to be trusted and not filed as spam, a sending domain (blueprint §19 already
   budgets *a domain*). This is a cost and a setting, both the owner's (§11, Q1).

### 3.3 Settings in the project (the owner's to change)

- The site's address, with the route the link opens, in the *allowed redirect URLs* of the auth settings. A link to an address that
  is not on the list is refused, which is the point of the list.
- The recovery email's template, so that it says what §1 says and nothing more.
- The mailbox sender (§3.2, point 4).
- Keep public sign-up **off**. Nothing in this slice changes it, and a test must not depend on it being on.

## 4. The words

On the request screen:

- Title *Forgot your password?* Blurb *We will email a link to the address your account uses.*
- The answer is *If that address has an account here, a link is on its way. It works once, for an hour.* with a second line,
  *Nothing arrived? Check spam, or ask whoever invited you to send a new invitation.*

The second line is the honest answer to a person with no mailbox access, and it needs no new feature.

On *Choose a new password*:

- The rules are the provider's, passed on in its words, as `changePassword` already does. The screen states them before the person
  types, not only after a refusal.
- A link that has been used, has expired or is not a link at all says one thing: *That link has already been used or has expired.
  Ask for a new one.* with the button back to the request screen. It never says which of the three it was.

Neither screen shows a household name, a member name or a figure, in any state.

## 5. The email

A short message from the project's sender: that a reset was asked for, one button, the hour it lasts, and *If this was not you,
ignore this email: your password has not changed.* No name, no household, no figure, no IP address (PW-I7).

Separately, **a change of password sends a notice** to the account's address (*Your password was changed on … If this was not you,
tell the owner of your household*), the *tell people about a new sign-in* item of `trust-and-security.md`. It is proposed, and
optional for slice 2 (§11, Q4).

## 6. The reasoning, for whoever reviews it

- **Why email at all, when the blueprint says there is no forgotten-password path?** That sentence is about *passkeys*, where no
  password exists. This app signs in with a password and a code, so a forgotten password is the ordinary case, and the second factor
  is what keeps the mailbox alone from being enough.
- **Why end every other session (PW-I6)?** A person resets because they think the password is not theirs alone. A session opened with
  the old password must not outlive the change.
- **Why one answer for every address (PW-I1)?** Otherwise the form tells a stranger which addresses have accounts, and a household
  app that is found by a stranger is one that has no front door but a login screen (blueprint layer 05). The provider answers the
  same either way; the screen must not add a difference of its own, in words, in the order of its steps or in how long it waits.
- **Why a global sign-out and a fresh sign-in rather than carrying on (PW-I2)?** So that the second factor is exercised once, at the
  moment it matters, and the reset session can never be mistaken for a full one.
- **What the owner role can and cannot do.** An owner cannot set someone's password or read it (nobody can: no superuser). An owner can
  re-invite, which is the existing path for a person with no mailbox.

## 7. Where it touches the code

| Piece | File | Change |
| --- | --- | --- |
| The request and the choose screens | `src/features/auth/SignInScreen.tsx` (or beside it) | two screens; a link under the password |
| The calls | `src/repo/auth.ts` | `requestPasswordReset`, `redeemRecoveryCode`, `finishPasswordReset`; the recovery stage in `AuthStage` and `currentAuthState` |
| The arrival | the app's entry, before the router | read `code`, exchange it once, clean the address |
| Messages | `src/repo/authErrors.ts` | the used-or-expired sentence; the provider's rate-limit refusal in words |
| Pure helpers | `src/lib/` | the code taken from an address and the address cleaned of it, so both can be tested |

No table, no policy and no migration. The audit log records changes to household data; a password change is the provider's event,
kept in its own log, and is not in the household's audit trail. (Said here so it is not a surprise: the household's *Your audit
log* does not show it.)

## 8. Tests

- **Unit:** the pure helpers (PW-I3); the screen's words, the same for every address (PW-I1); the stage mapping, a recovery session
  being neither signed in nor needing a code (PW-I4); the refusals in words.
- **End to end:** the request screen up to *a link is on its way*, for an address that has an account and one that has none,
  asserting the **same** text and the same buttons (PW-I1); the link on *Sign in* exists; the screen never offers a way to reset
  an authenticator (PW-I10). The suite cannot read a mailbox, so it cannot follow the link.
- **By hand, once, before it is called built:** the whole path against the live project with a mailbox the owner controls: request,
  arrive, choose, sign in with the new password, meet the code prompt (PW-I2), and see an old session ended (PW-I6). The result goes
  in the pull request in words, since CI cannot prove it.
- **Policy suite:** nothing new, because nothing in the database changes.

## 9. Order of work

1. **A spike, no screen: the arrival and the answer to §3.2 point 3.** Read the code from the address, exchange it, and try
   `updateUser` from the recovery session on an account that has an authenticator. Record what the provider does. Needs the
   sender of §3.2 point 4 set up, or the project's own address as the recipient.
   - Gate: the answer is written into this document, §3.2 point 3 is rewritten from it, and any change it forces to §1 is shown to
     the owner before slice 2.
2. **The request and choose screens, with the stage and the cleanup of the address.** Unit tests first for the pure parts.
   - Gate: PW-I1 to PW-I6 and PW-I8 to PW-I10 have tests; the by-hand path of §8 is done and written up; the design-conformance
     review is done.
3. **A lost authenticator** (a separate design): recovery codes at enrolment and the owner's re-invite, blueprint layer 10.
   - Gate: its own document, since it changes enrolment and adds a table.
4. **The notice of a changed password** (§5), if the owner wants it.

## 10. Edits to other documents (all proposed; to apply with the build)

- **`docs/blueprint.md`, layer 10:** after *Email one-time codes belong here and only here*, add: *A forgotten password is recovered by
  a link sent to the account's address, and changes the password only; the authenticator is still asked for (`password-reset.md`).*
- **`docs/design/trust-and-security.md`, *Protecting the account*:** note that *recovery* now has its first item, and that a lost
  authenticator is still open.
- **`docs/build-plan.md`:** a line under the auth step naming slices 1 to 4 above, none built.
- **`docs/design/conformance.md`:** a row for the sign-in screen's new link and the two new screens, `proposed`, with *no board
  draws them* in the Artboard column, until the owner supplies one.
- **`docs/design/waivers.md`:** each invariant below waived, as *designed, not built*, until its slice.
- **`.claude/agents/design-conformance.md`:** this document named in the reviewer's brief.

## 11. Questions for the owner

1. **The sender.** Real delivery needs the project's own SMTP sender, and trust in it needs a domain. Which sender, and is the domain
   bought? Until it is, the reset cannot be used by a family member, and the by-hand test of §8 needs a mailbox of yours.
2. **The test account's address.** The end-to-end account is `testdemo1@ggmail.com`, which is `ggmail`, not `gmail`. If that is not a
   mailbox you control, a reset for it can never be completed. Is it, or should the test account move to an address you read?
3. **Scope.** Reset only now, with the lost authenticator as its own design afterwards (the order of §9)? Or one document for both?
4. **A notice when the password changes** (§5): in slice 2, later, or not at all?
5. **The link's life.** The provider's default of an hour is proposed. Shorter is safer and longer is kinder to a slow mailbox.

## Invariants

**PW-I1 — The request screen answers the same for an address that has an account and one that has none:** the same words, the same
buttons and the same steps, and it never says whether the address is known. (§1, §6)

**PW-I2 — A reset changes the password and nothing else:** after it the person signs in with the new password and is asked for the
authenticator code like anyone else; no session from a reset reads household data. (§2, §6)

**PW-I3 — The link's code is read once, before the router, and removed from the address bar,** and is never written to storage, a
log or a message. (§3.2)

**PW-I4 — A recovery session reaches the *Choose a new password* screen and nothing else:** no household, no member and no figure is
read or shown while it is the only session. (§3.2)

**PW-I5 — The new password is held to the same rules, in the same words, as a change made while signed in,** and the app never keeps
it. (§1, §4)

**PW-I6 — Choosing a new password ends every session the account has,** not only the one that chose it. (§3.1, §6)

**PW-I7 — No email is sent by the app's own code, and the email carries no household name, member name, figure or IP address.** (§2, §5)

**PW-I8 — A reset is for an account that already exists:** it creates none, and public sign-up stays off. (§2)

**PW-I9 — The request button is disabled while a request is being made and says so after a refusal for too many requests,** in
words, with no figure for the wait unless the provider gives one. (§4)

**PW-I10 — No screen offers to reset or remove an authenticator,** and a reset never changes one. (§2)

## Tests

- PW-I1: the same text for a known and an unknown address (unit on the words; end to end on the screen).
- PW-I2: the stage after a reset is *signed out*, and signing in asks for the code (by hand, §8; unit on the stage mapping).
- PW-I3: the helper that takes the code from an address and gives back the address without it, including a hash route after it.
- PW-I4: a recovery session maps to its own stage, which no data hook reads.
- PW-I5: the same rules function for both forms.
- PW-I6: by hand, §8, since it needs two sessions and a mailbox.
- PW-I7: the email template as kept in this document, §5, read by a person at review.
- PW-I8: no call in the new code creates a user, and the project's setting is recorded as off.
- PW-I9: the button and its words (unit and end to end).
- PW-I10: no text on the sign-in screens offers it (end to end).
