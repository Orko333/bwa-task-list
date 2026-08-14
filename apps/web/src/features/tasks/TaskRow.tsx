import { useSortable } from '@dnd-kit/sortable';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';

import { IconButton } from '../../components/IconButton';
import { ChevronIcon, GripIcon, PencilIcon, PlusIcon, TrashIcon } from '../../components/icons';
import type { Task } from '../../domain/task';
import { useStores } from '../../stores/context';
import styles from './TaskRow.module.css';
import { TitleField } from './TitleField';

export interface RowCallbacks {
  onAddSubtask: (task: Task) => void;
  onRename: (task: Task) => void;
  onDelete: (task: Task) => void;
  onNudge: (task: Task, direction: -1 | 1) => void;
  onShift: (task: Task, direction: -1 | 1) => void;
}

interface TaskRowProps extends RowCallbacks {
  task: Task;
  hasChildren: boolean;
  collapsed: boolean;
  subtaskCount: number;
  /** Level the drop would land on; only set while this row is being dragged. */
  projectedDepth?: number;
  /** True for a moment after a keyboard move, so the row can be found again. */
  settled: boolean;
  editing: boolean;
  onCommitRename: (task: Task, title: string) => void;
  onCancelRename: () => void;
}

export const TaskRow = observer(function TaskRow({
  task,
  hasChildren,
  collapsed,
  subtaskCount,
  projectedDepth,
  settled,
  editing,
  onAddSubtask,
  onRename,
  onDelete,
  onNudge,
  onShift,
  onCommitRename,
  onCancelRename,
}: TaskRowProps) {
  const { tasks: store } = useStores();
  const { listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id, disabled: editing || store.isPending(task.id) });

  const item = useRef<HTMLLIElement | null>(null);
  const wasEditing = useRef(false);

  // When the rename field closes, focus has nowhere to go and lands on <body>.
  // Put it back on the row so the keyboard shortcuts stay reachable.
  useEffect(() => {
    if (wasEditing.current && !editing) item.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  const depth = projectedDepth ?? task.depth;
  const pending = store.isPending(task.id);
  const atLimit = !store.canHaveSubtasks(task);

  const style: CSSProperties = {
    // Only the vertical half of the drag moves the row. Sideways travel is
    // expressed by re-indenting it, so the row never leaves the card.
    transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined,
    transition,
    ['--depth-offset' as string]: depth - 1,
  };

  function handleKeyDown(event: KeyboardEvent<HTMLLIElement>): void {
    if (editing || pending) return;

    // The Alt/Option modifier keeps the bare arrow keys for page scrolling and
    // for whatever the focused control already does with them.
    if (event.altKey) {
      const command: Record<string, () => void> = {
        ArrowUp: () => onNudge(task, -1),
        ArrowDown: () => onNudge(task, 1),
        ArrowLeft: () => onShift(task, -1),
        ArrowRight: () => onShift(task, 1),
      };

      const run = command[event.key];
      if (run) {
        event.preventDefault();
        run();
      }
      return;
    }

    if (event.key === 'Enter' && event.target === event.currentTarget) {
      event.preventDefault();
      onRename(task);
    }
  }

  return (
    <li
      ref={(node) => {
        setNodeRef(node);
        item.current = node;
      }}
      style={style}
      className={[styles.item, isDragging && styles.dragging, settled && styles.settled]
        .filter(Boolean)
        .join(' ')}
      tabIndex={editing ? -1 : 0}
      aria-label={`${task.title}, level ${task.depth}`}
      aria-roledescription="Draggable task"
      onKeyDown={handleKeyDown}
    >
      <span className={styles.rails} aria-hidden />

      {/* The row itself is the handle: the sensors decide that a press on one of
          the buttons inside it is not the start of a drag. */}
      <div ref={setActivatorNodeRef} className={styles.row} {...(pending ? {} : listeners)}>
        <span className={styles.handle} aria-hidden>
          <GripIcon />
        </span>

        {hasChildren ? (
          <button
            type="button"
            className={[styles.disclosure, !collapsed && styles.expanded].filter(Boolean).join(' ')}
            aria-label={collapsed ? `Show subtasks of ${task.title}` : `Hide subtasks of ${task.title}`}
            aria-expanded={!collapsed}
            onClick={() => store.toggleCollapsed(task.id)}
          >
            <ChevronIcon />
          </button>
        ) : (
          <span className={styles.spacer} aria-hidden />
        )}

        {editing ? (
          <TitleField
            initialValue={task.title}
            maxLength={store.limits.maxTitleLength}
            ariaLabel="Task name"
            onCommit={(value) => onCommitRename(task, value)}
            onCancel={onCancelRename}
          />
        ) : (
          <>
            <span
              className={[styles.title, pending && styles.pending].filter(Boolean).join(' ')}
              title={task.title}
            >
              {task.title}
            </span>

            {isDragging && subtaskCount > 0 && (
              <span className={styles.branchSize} title={`${subtaskCount + 1} rows are moving`}>
                {subtaskCount + 1}
              </span>
            )}

            {!isDragging && collapsed && subtaskCount > 0 && (
              <span className={styles.count}>{subtaskCount}</span>
            )}

            {atLimit && (
              <span className={styles.limit} title="Deepest level. This task cannot take subtasks.">
                <span className={styles.limitWord}>level </span>
                {task.depth}
              </span>
            )}

            <div className={styles.actions}>
              {!atLimit && (
                <IconButton
                  label={`Add a subtask to ${task.title}`}
                  disabled={pending}
                  onClick={() => onAddSubtask(task)}
                >
                  <PlusIcon />
                </IconButton>
              )}
              <IconButton
                label={`Rename ${task.title}`}
                disabled={pending}
                onClick={() => onRename(task)}
              >
                <PencilIcon />
              </IconButton>
              <IconButton
                label={`Delete ${task.title}`}
                tone="danger"
                disabled={pending}
                onClick={() => onDelete(task)}
              >
                <TrashIcon />
              </IconButton>
            </div>
          </>
        )}
      </div>
    </li>
  );
});
