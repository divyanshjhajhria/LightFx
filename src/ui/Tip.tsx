// A one-sentence explanation above a control, after 300ms of hover or keyboard focus. The control is described by it,
// so a screen reader reads it too.
import { cloneElement, useEffect, useId, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

export const TIP_DELAY_MS = 300;

export function Tip({ text, children }: { text: string; children: ReactElement<{ 'aria-describedby'?: string }> }) {
  const [show, setShow] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const id = useId();
  const on = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShow(true), TIP_DELAY_MS);
  };
  const off = () => {
    window.clearTimeout(timer.current);
    setShow(false);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <span className="tipWrap" onMouseEnter={on} onMouseLeave={off} onFocus={on} onBlur={off} onPointerDown={off}>
      {cloneElement(children, { 'aria-describedby': id })}
      <span role="tooltip" id={id} className="tip glass" hidden={!show}>
        {text}
      </span>
    </span>
  );
}

/** A dock button that opens a small panel above it. Escape or a click elsewhere closes the panel. */
export function DockMenu({
  label,
  tip,
  ariaLabel,
  children,
}: {
  label: ReactNode;
  tip: string;
  ariaLabel: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('keydown', key, { capture: true });
    box.current?.querySelector<HTMLElement>('.dockPop button, .dockPop input')?.focus();
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('keydown', key, { capture: true });
    };
  }, [open]);
  return (
    <div className="dockMenu" ref={box}>
      <Tip text={tip}>
        <button ref={button} className="dockButton" aria-label={ariaLabel} aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)}>
          {label}
          <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
            <path d="M1.5 6.5L5 3l3.5 3.5" />
          </svg>
        </button>
      </Tip>
      {open && (
        <div className="dockPop glass" role="group" aria-label={ariaLabel}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
