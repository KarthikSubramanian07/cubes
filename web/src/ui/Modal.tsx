import { useEffect, useId, useRef, type ReactNode } from "react";
import "./overlay.css";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Optional Caveat aside shown above the title. */
  note?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * A native <dialog> opened with showModal(): focus trapping, Escape and the
 * top layer come from the browser. Clicking the backdrop closes it.
 */
export function Modal({ open, onClose, title, children, note, footer, className }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");
    } else if (!open && d.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={["modal", className].filter(Boolean).join(" ")}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal__body">
        <button type="button" className="modal__close" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
            <path d="M4.5 4.8 C 8 8.2, 12 12, 15.6 15.4 M15.2 4.4 C 11.6 8.4, 8.4 11.8, 4.4 15.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </svg>
        </button>
        {note && <p className="modal__note" aria-hidden="true">{note}</p>}
        <h2 id={titleId} className="modal__title">
          {title}
        </h2>
        <div className="modal__content">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </dialog>
  );
}
