/**
 * The account menu — an initial, and everything about *you* behind it.
 *
 * It replaces an email address printed in the top bar. That was there for a
 * real reason: two accounts on one phone is the ordinary case in a household,
 * and there was nothing on screen to tell them apart. But an address on every
 * screen is also an address in every screenshot and over every shoulder, which
 * is a poor trade for a question asked once a session.
 *
 * So the initial answers "who am I signed in as" at a glance, and the address
 * itself is one tap away.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

export function AccountMenu({
  email,
  role,
  householdName,
  onProfile,
  onSettings,
  onSignOut,
}: {
  email: string | null;
  role: string | null;
  householdName: string | null;
  onProfile: () => void;
  onSettings: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  /**
   * Close on an outside click or on Escape.
   *
   * Escape returns focus to the trigger, because a menu that closes and leaves
   * focus on the document body strands anybody navigating by keyboard at the
   * top of the page — they have to tab all the way back to where they were.
   */
  useEffect(() => {
    if (!open) return;

    const onPointer = (event: MouseEvent) => {
      if (wrap.current !== null && !wrap.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // The first letter of the address, which is all there is to go on until a
  // member's display name is loaded here. A question mark rather than a blank
  // circle when even that is missing: an empty control looks broken.
  const initial = (email ?? '?').trim().charAt(0).toUpperCase();

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <button
        ref={trigger}
        type="button"
        className="avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        // The visible content is one letter, which reads as the letter and not
        // as an account. The label is what a screen reader announces instead.
        aria-label={email === null ? 'Account' : `Account: ${email}`}
        onClick={() => {
          setOpen((was) => !was);
        }}
      >
        {initial}
      </button>

      {open && (
        <div className="menu" role="menu">
          <div className="mhead">
            <b>{email ?? 'Signed in'}</b>
            <span>
              {role ?? 'member'}
              {householdName === null ? '' : ` · ${householdName}`}
            </span>
          </div>

          <MenuItem
            onClick={() => {
              setOpen(false);
              onProfile();
            }}
          >
            Profile
          </MenuItem>
          <MenuItem
            onClick={() => {
              setOpen(false);
              onSettings();
            }}
          >
            Settings
          </MenuItem>
          <MenuItem
            quiet
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            Sign out
          </MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  quiet = false,
  onClick,
}: {
  children: ReactNode;
  quiet?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" role="menuitem" className={quiet ? 'mitem mitem-quiet' : 'mitem'} onClick={onClick}>
      {children}
    </button>
  );
}
