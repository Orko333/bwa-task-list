import type { ButtonHTMLAttributes, ReactNode } from 'react';

import styles from './IconButton.module.css';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Read out by screen readers and shown as the native tooltip. */
  label: string;
  tone?: 'neutral' | 'danger';
  children: ReactNode;
}

export function IconButton({
  label,
  tone = 'neutral',
  children,
  className,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // Keeps the press from blurring an open inline field first, which would
      // close it and remove this button before the click landed.
      onMouseDown={(event) => event.preventDefault()}
      className={[styles.button, tone === 'danger' && styles.danger, className]
        .filter(Boolean)
        .join(' ')}
      {...rest}
    >
      {children}
    </button>
  );
}
