import { useEffect, useRef } from 'react';

import styles from './ConfirmDialog.module.css';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Built on the native `<dialog>`: the browser already handles the backdrop,
 * focus trapping, Escape and returning focus to whatever opened it.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;

    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      className={styles.dialog}
      aria-labelledby="confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={(event) => {
        // A click that lands on the dialog element itself is a click on the
        // backdrop; anything inside hits a child first.
        if (event.target === dialog.current) onCancel();
      }}
    >
      <h2 id="confirm-title" className={styles.title}>
        {title}
      </h2>
      <p className={styles.body}>{description}</p>

      <div className={styles.actions}>
        <button type="button" className={`${styles.button} ${styles.cancel}`} onClick={onCancel}>
          Keep
        </button>
        {/* Focus lands on "Keep" first, so Enter on a dialog that appeared
            unexpectedly cancels rather than deletes. */}
        <button type="button" className={`${styles.button} ${styles.confirm}`} onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
