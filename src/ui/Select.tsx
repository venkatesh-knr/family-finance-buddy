/**
 * A choice: the underline field with a chevron, opening a bottom sheet of options (docs/design/simple-layout.md section 3).
 *
 * It takes `<option>` children and a value, as a `<select>` does, and calls `onChange` with an object that has `target.value`, so a form
 * written for a native select moves onto it by changing the tag. What differs is what a person sees: the label above, the value
 * on one underline with a chevron, and a sheet of options rising from the bottom of the screen.
 *
 * Markup: a `button` with `role="combobox"` named by its label and its value, which opens a modal `dialog` holding a `listbox` of
 * `option` buttons. Escape, a tap outside and choosing an option close it, and focus goes back to the field. The selected option is
 * marked with a tick as well as by weight, so it is not marked by one thing alone.
 */

import { Children, Fragment, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ParsedOption {
  readonly value: string;
  readonly label: string;
  readonly disabled: boolean;
}

function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : isValidElement(child) ? textOf((child.props as { children?: ReactNode }).children) : ''))
    .join('');
}

/** The `<option>` elements among some children, flattening fragments and arrays. */
function optionsOf(children: ReactNode): ParsedOption[] {
  const found: ParsedOption[] = [];
  const walk = (node: ReactNode): void => {
    Children.forEach(node, (child) => {
      if (!isValidElement(child)) return;
      const element = child as ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>;
      if (element.type === Fragment) {
        walk(element.props.children);
      } else if (element.type === 'option') {
        const label = textOf(element.props.children);
        found.push({ value: element.props.value === undefined ? label : String(element.props.value), label, disabled: element.props.disabled === true });
      } else if (typeof element.type === 'function') {
        // A component that renders options (CurrencyOptions): called, since it has no hooks, to read what it makes.
        const render = element.type as (props: unknown) => ReactNode;
        walk(render(element.props));
      }
    });
  };
  walk(children);
  return found;
}

export function Select({
  label,
  labelExtra,
  value,
  onChange,
  children,
  hint,
  error,
  className,
  disabled = false,
  required = false,
  id,
}: {
  label: string;
  /** After the label: an info mark that says what the field is for. */
  labelExtra?: ReactNode;
  value: string;
  onChange: (event: { readonly target: { readonly value: string } }) => void;
  children: ReactNode;
  hint?: string;
  /** What is wrong, in words, under the field. The underline turns amber. */
  error?: string | null;
  /** Layout classes for the whole field (its width), as a wrapping label took before. */
  className?: string;
  disabled?: boolean;
  required?: boolean;
  id?: string;
}) {
  const generated = useId().replace(/:/g, '');
  const base = id ?? `select${generated}`;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const options = optionsOf(children);
  const selected = options.find((option) => option.value === value);
  const describedBy = [hint === undefined ? null : `${base}-hint`, error ? `${base}-error` : null].filter(Boolean).join(' ');

  const close = (): void => {
    setOpen(false);
    trigger.current?.focus();
  };

  // On opening, the selected option (or the first) takes focus, so the keyboard is in the list at once.
  useEffect(() => {
    if (!open) return;
    const buttons = sheet.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not([disabled])');
    const chosen = sheet.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]');
    (chosen ?? buttons?.[0])?.focus();
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    const buttons = Array.from(sheet.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not([disabled])') ?? []);
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
      event.preventDefault();
      buttons[(at + 1) % buttons.length]?.focus();
    } else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
      event.preventDefault();
      buttons[(at - 1 + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      buttons[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      buttons[buttons.length - 1]?.focus();
    }
  };

  return (
    <div className={`select-field ${className ?? ''}`.trim()}>
      <span className="label" id={`${base}-label`}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
        {labelExtra}
      </span>
      <button
        ref={trigger}
        id={base}
        type="button"
        className="field select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${base}-label ${base}-value`}
        aria-describedby={describedBy === '' ? undefined : describedBy}
        aria-invalid={error ? true : undefined}
        aria-required={required ? true : undefined}
        disabled={disabled}
        onClick={() => {
          setOpen(true);
        }}
      >
        <span id={`${base}-value`}>{selected === undefined ? '' : selected.label}</span>
        <svg className="select-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {hint !== undefined && (
        <span className="field-help" id={`${base}-hint`}>
          {hint}
        </span>
      )}
      {error ? (
        <span className="field-error" id={`${base}-error`} role="alert">
          {error}
        </span>
      ) : null}
      {open &&
        createPortal(
          <div
            className="sheet-backdrop"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) close();
            }}
          >
            <div ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-label={label} onKeyDown={onKeyDown}>
              <div className="sheet-title" aria-hidden="true">
                {label}
              </div>
              <div role="listbox" aria-label={label}>
                {options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="option"
                    className="sheet-option"
                    aria-selected={option.value === value}
                    disabled={option.disabled}
                    onClick={() => {
                      onChange({ target: { value: option.value } });
                      close();
                    }}
                  >
                    <span>{option.label}</span>
                    {option.value === value && <span aria-hidden="true">✓</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
