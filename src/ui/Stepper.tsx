/**
 * A form in steps, on a screen of its own (docs/design/simple-layout.md section 4; the AddStep1 and AddStep2 boards).
 *
 * A top bar with back and the form's name; under it the step's name, "Step n of m" and a segmented progress line; the step's fields; and one
 * full-width button at the bottom, Next, and on the last step the form's verb. Next is enabled when the step's required fields are filled.
 * The bottom bar of the app is covered, because the form has the screen.
 *
 * The values are the caller's, and every step stays mounted (the others hidden). This component holds only which step it is on, so going Back shows every value typed, and nothing is
 * written until the last step's button calls `onFinish`: leaving half-way, by Back from the first step or the close of the form, leaves
 * nothing behind (SL-I6).
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button, Problem } from './primitives.tsx';

export interface Step {
  /** What this step is about: "What it is", "Weight and cost". */
  readonly name: string;
  /** Whether the required fields of this step are filled, which is what enables Next. */
  readonly ready: boolean;
  readonly content: ReactNode;
}

export function Stepper({
  title,
  steps,
  finishLabel,
  busy = false,
  problem = null,
  done = false,
  show = null,
  onFinish,
  onCancel,
}: {
  /** The form's name: "Add a holding". It names the form and the top bar. */
  title: string;
  steps: readonly Step[];
  /** The form's verb on the last step: "Add gold". */
  finishLabel: string;
  busy?: boolean;
  problem?: string | null;
  /** The form has written what it was asked to, though something is still to be said (a value that could not be recorded): the button closes it. */
  done?: boolean;
  /**
   * Ask for a step to be shown, with the first field that is marked wrong on it focused: for a problem found on a later step about a field on
   * an earlier one, which must not leave the person to go back and look for it. `key` changes for each request, so the same step can be asked for twice.
   */
  show?: { readonly step: number; readonly key: number } | null;
  onFinish: () => void | Promise<void>;
  /** Back from the first step, and Escape: closes the form, having written nothing. */
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const last = index === steps.length - 1;
  const step = steps[index] as Step;

  // A step takes focus when it opens, so a screen reader hears where it is and the keyboard starts at the top.
  useEffect(() => {
    heading.current?.focus();
  }, [index]);

  const asked = show === null ? null : show.key;
  useEffect(() => {
    if (show === null) return;
    setIndex(Math.min(Math.max(show.step, 0), steps.length - 1));
    // After the step has shown, so the field is on screen to be focused.
    const frame = requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
    // Only a new request moves the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

  // The form has the screen: what is behind it does not scroll.
  useEffect(() => {
    const was = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = was;
    };
  }, []);

  const back = (): void => {
    if (index === 0) onCancel();
    else setIndex(index - 1);
  };

  return createPortal(
    <div
      className="step-form"
      role="dialog"
      aria-modal="true"
      aria-label={`${title}, step ${String(index + 1)} of ${String(steps.length)}`}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onCancel();
      }}
    >
      <form
        ref={formRef}
        aria-label={title}
        // The steps check themselves (Next waits for the required fields), and a required field on a step that is hidden would stop the form.
        noValidate
        className="flex min-h-full flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          if (done) {
            onCancel();
            return;
          }
          if (!step.ready || busy) return;
          if (last) void onFinish();
          else setIndex(index + 1);
        }}
      >
        <div className="step-form-bar">
          <button type="button" className="step-form-back" aria-label={index === 0 ? `Close ${title}` : 'Back'} onClick={back}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <span className="step-form-title">{title}</span>
        </div>
        <div className="step-form-body">
          <div className="step-form-stepline">
            <h2 ref={heading} tabIndex={-1} className="text-[0.78rem] font-semibold outline-none">
              {step.name}
            </h2>
            <p className="note" data-testid="step-count">
              Step {index + 1} of {steps.length}
            </p>
          </div>
          <div className="step-form-progress" role="progressbar" aria-label="Progress" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={index + 1}>
            {steps.map((_, at) => (
              <i key={at} data-done={at <= index} />
            ))}
          </div>
          {/* Every step stays mounted and the others are hidden, so what was typed is kept whichever way the person goes. */}
          {steps.map((each, at) => (
            <div key={each.name} hidden={at !== index} className={at === index ? 'mt-4 flex flex-col gap-4' : 'hidden'}>
              {each.content}
            </div>
          ))}
          {problem !== null && (
            <div className="mt-3">
              <Problem>{problem}</Problem>
            </div>
          )}
        </div>
        <div className="step-form-foot">
          <Button type="submit" disabled={!done && (!step.ready || busy)}>
            {done ? 'Done' : last ? (busy ? 'Adding…' : finishLabel) : 'Next'}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
