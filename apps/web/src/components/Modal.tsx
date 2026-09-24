import { ReactNode, useCallback, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}

/**
 * A dialog rendered into document.body: closes on Escape or a click on the backdrop, takes focus on
 * open and hands it back on close. One dialog at a time, which is all a kiosk screen needs.
 */
export function Modal({ title, onClose, children, testId }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const close = useCallback(() => onClose(), [onClose]);
  // Unique per dialog: two dialogs sharing an id would break aria-labelledby.
  const titleId = useId();

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
        return;
      }
      // aria-modal promises the page behind is unreachable; keep Tab inside the dialog so it is.
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!event.shiftKey && (active === last || active === panelRef.current)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [close]);

  return createPortal(
    <div
      className="modal-backdrop"
      // mousedown on the backdrop itself, so a drag that ends outside the panel does not close it
      onMouseDown={(event) => event.target === event.currentTarget && close()}
    >
      <div
        className="modal panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={panelRef}
        data-testid={testId}
      >
        <header className="panel-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="link" onClick={close}>
            close
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
