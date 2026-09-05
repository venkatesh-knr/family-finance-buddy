import { describe, expect, it } from 'vitest';
import { inviteState, type Invite } from './invites.ts';

/**
 * An invite's state is derived, never stored — it does not change when it
 * expires, it simply stops working. These fixtures pin the boundaries, because
 * "expired" and "still open" differ by a moment and the difference decides
 * whether a stranger gets into a household.
 */

const base: Invite = {
  id: 'inv-1',
  displayName: 'Meera',
  colour: 'c2',
  role: 'partner',
  email: null,
  expiresAt: '2026-09-12T10:00:00Z',
  acceptedAt: null,
  revokedAt: null,
};

const at = (iso: string) => new Date(iso);

describe('inviteState', () => {
  it('is open before the expiry', () => {
    expect(inviteState(base, at('2026-09-12T09:59:59Z'))).toBe('open');
  });

  it('is expired at the expiry, not a moment after', () => {
    // The function refuses on `expires_at <= now`, so the boundary itself is
    // already too late. Matching that here keeps the two in step.
    expect(inviteState(base, at('2026-09-12T10:00:00Z'))).toBe('expired');
  });

  it('reports accepted ahead of expired, since that is what happened', () => {
    const accepted = { ...base, acceptedAt: '2026-09-08T12:00:00Z' };
    expect(inviteState(accepted, at('2026-10-01T00:00:00Z'))).toBe('accepted');
  });

  it('reports revoked ahead of expired for the same reason', () => {
    const revoked = { ...base, revokedAt: '2026-09-08T12:00:00Z' };
    expect(inviteState(revoked, at('2026-10-01T00:00:00Z'))).toBe('revoked');
  });

  it('prefers accepted over revoked when somehow both are set', () => {
    const both = { ...base, acceptedAt: '2026-09-08T12:00:00Z', revokedAt: '2026-09-09T12:00:00Z' };
    // A check constraint makes this unreachable, but a reader should not have
    // to prove that to know what this returns.
    expect(inviteState(both, at('2026-09-10T00:00:00Z'))).toBe('accepted');
  });

  it('never reads the clock itself', () => {
    const when = at('2026-09-10T00:00:00Z');
    expect(inviteState(base, when)).toBe(inviteState(base, when));
  });
});
