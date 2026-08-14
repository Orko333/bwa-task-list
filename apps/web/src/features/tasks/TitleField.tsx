import { useEffect, useRef, useState } from 'react';

import styles from './TitleField.module.css';

interface TitleFieldProps {
  initialValue: string;
  maxLength: number;
  placeholder?: string;
  ariaLabel: string;
  /** Return true to keep the field open, which the composer uses to add in a run. */
  onCommit: (value: string) => boolean | void;
  onCancel: () => void;
}

/**
 * The single text input used for both renaming a task and adding one.
 *
 * Enter commits, Escape restores what was there before. Blurring commits as
 * well: clicking away from a half-finished rename almost always means "keep it",
 * and Escape is right there for the other case.
 */
export function TitleField({
  initialValue,
  maxLength,
  placeholder,
  ariaLabel,
  onCommit,
  onCancel,
}: TitleFieldProps) {
  const [value, setValue] = useState(initialValue);
  const input = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  function commit(): void {
    if (cancelled.current) return;

    const keepOpen = onCommit(value);
    if (keepOpen) {
      setValue('');
      input.current?.focus();
    }
  }

  return (
    <input
      ref={input}
      className={styles.field}
      name="title"
      value={value}
      maxLength={maxLength}
      placeholder={placeholder}
      aria-label={ariaLabel}
      autoComplete="off"
      spellCheck={false}
      enterKeyHint="done"
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          cancelled.current = true;
          onCancel();
        }
      }}
    />
  );
}
