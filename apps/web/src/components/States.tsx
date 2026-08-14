import styles from './States.module.css';

/** Placeholder rows at staggered widths, so loading reads as a list, not a block. */
export function TaskSkeleton() {
  const widths = [58, 41, 34, 47, 29, 52];

  return (
    <div className={styles.skeleton} aria-hidden>
      {widths.map((width, level) => (
        <div
          key={width}
          className={styles.line}
          style={{ width: `${width}%`, marginInlineStart: `${(level % 3) * 26}px` }}
        />
      ))}
    </div>
  );
}

interface EmptyStateProps {
  onAdd: () => void;
}

export function EmptyState({ onAdd }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>Nothing here yet</p>
      <p className={styles.emptyBody}>
        Add a task, then use <kbd>+</kbd> on any row to break it into subtasks.
      </p>
      <button type="button" className={styles.emptyAction} onClick={onAdd}>
        Add the first task
      </button>
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>The list did not load</p>
      <p className={styles.emptyBody}>{message}</p>
      <button type="button" className={styles.emptyAction} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
