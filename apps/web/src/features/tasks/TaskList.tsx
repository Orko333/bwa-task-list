import {
  DndContext,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { observer } from 'mobx-react-lite';
import { Fragment, useEffect, useRef, useMemo, useState } from 'react';

import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/States';
import { project, type Projection, type VisibleRow } from '../../domain/projection';
import { branchIds, descendantCount, type Task } from '../../domain/task';
import { ALT_KEY_NAME } from '../../platform';
import { useStores } from '../../stores/context';
import type { TaskStore } from '../../stores/TaskStore';
import { AddTaskBar, ComposerRow } from './Composer';
import { useIndent } from './constants';
import { RowMouseSensor, RowTouchSensor } from './sensors';
import styles from './TaskList.module.css';
import { TaskRow } from './TaskRow';

interface DragState {
  id: string;
  offsetX: number;
  overId: string | null;
}

export const TaskList = observer(function TaskList() {
  const { tasks: store, toasts } = useStores();

  const [drag, setDrag] = useState<DragState | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [composerParent, setComposerParent] = useState<Task | null | undefined>(undefined);
  const [pendingDelete, setPendingDelete] = useState<Task | null>(null);
  const [announcement, setAnnouncement] = useState('');
  /** Row that just moved without the pointer, held long enough to follow it. */
  const [settling, setSettling] = useState<string | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
  }, []);

  /**
   * A keyboard move relocates the row while the eye is somewhere else, so it is
   * marked for a moment afterwards. Without it the list simply looks different
   * and it is on the user to work out what changed.
   */
  function markSettled(id: string): void {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    setSettling(id);
    settleTimer.current = setTimeout(() => setSettling(null), 1400);
  }

  const sensors = useSensors(
    // A press that does not travel is a click, so the buttons on a row keep
    // working even though the row itself is the handle.
    useSensor(RowMouseSensor, { activationConstraint: { distance: 4 } }),
    // On touch the separation is time, not distance: a swipe scrolls the list,
    // a hold picks the row up.
    useSensor(RowTouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const indent = useIndent();
  const rows = store.rows;

  /**
   * While a branch is dragged its descendants leave the list, so it travels as
   * one block and the row under the cursor is never one of its own children.
   */
  const draggable = useMemo(
    () => (drag ? withoutDescendants(rows, store.tasks, drag.id) : rows),
    [rows, store.tasks, drag],
  );

  const projection = useMemo(() => {
    if (!drag?.overId) return null;

    const from = draggable.findIndex((row) => row.task.id === drag.id);
    const to = draggable.findIndex((row) => row.task.id === drag.overId);
    if (from === -1 || to === -1) return null;

    return projectAt(arrayMove([...draggable], from, to), to, drag.id, drag.offsetX, store, indent);
  }, [draggable, drag, store, indent]);

  // pointer drag

  function handleDragStart({ active }: DragStartEvent): void {
    setEditingId(null);
    setDrag({ id: String(active.id), offsetX: 0, overId: String(active.id) });
  }

  function handleDragMove({ delta }: DragMoveEvent): void {
    setDrag((current) => (current ? { ...current, offsetX: delta.x } : current));
  }

  function handleDragOver({ over }: DragOverEvent): void {
    setDrag((current) =>
      current ? { ...current, overId: over ? String(over.id) : null } : current,
    );
  }

  function handleDragEnd(_event: DragEndEvent): void {
    const active = drag;
    const target = projection;
    setDrag(null);

    if (!active) return;

    if (!target) {
      // The slot the pointer was over has no level that keeps the branch inside
      // the nesting limit. Saying so beats a row that silently springs back.
      toasts.show('info', `There is no room for that branch here. It stays where it was.`);
      return;
    }

    void store.move(active.id, target.insertBeforeIndex, target.depth);
  }

  // keyboard reordering

  /**
   * The modifier plus up and down walks the row through the visible slots, the
   * same ones a pointer would drop it into. The level can change on the way: a
   * slot between two deeper rows has no shallower level to offer.
   */
  function nudge(task: Task, direction: -1 | 1): void {
    const list = withoutDescendants(rows, store.tasks, task.id);
    const from = list.findIndex((row) => row.task.id === task.id);
    const to = from + direction;

    if (from === -1 || to < 0 || to >= list.length) return;

    const target = projectAt(arrayMove(list, from, to), to, task.id, 0, store, indent);
    if (!target) {
      setAnnouncement(`${task.title} cannot move there, the branch would not fit`);
      return;
    }

    void store.move(task.id, target.insertBeforeIndex, target.depth);
    markSettled(task.id);
    setAnnouncement(
      target.depth === task.depth
        ? `${task.title} moved ${direction === -1 ? 'up' : 'down'}`
        : `${task.title} moved ${direction === -1 ? 'up' : 'down'} to level ${target.depth}`,
    );
  }

  /**
   * The modifier plus left and right are the outliner's indent and outdent, not
   * a sideways drag. Indent makes the row the last child of the sibling above it;
   * outdent lifts it out and drops it after its parent's branch. Routing these
   * through the drag projection would refuse most of them, because the projection
   * judges a fixed slot while these two are allowed to move the row.
   */
  function indentRow(task: Task): void {
    const previousSibling = store.previousSiblingIndex(task.id);
    if (previousSibling === -1) return;

    const depth = task.depth + 1;
    if (depth + store.heightOf(task.id) > store.limits.maxDepth) {
      setAnnouncement(`${task.title} cannot go deeper than level ${store.limits.maxDepth}`);
      return;
    }

    const index = store.tasks.findIndex((row) => row.id === task.id);
    void store.move(task.id, index, depth);
    markSettled(task.id);
    setAnnouncement(`${task.title} moved to level ${depth}`);
  }

  function outdentRow(task: Task): void {
    if (task.parentId === null) return;

    const parentIndex = store.tasks.findIndex((row) => row.id === task.parentId);
    const parent = store.tasks[parentIndex];
    if (!parent) return;

    const afterParentBranch = parentIndex + descendantCount(store.tasks, parentIndex) + 1;

    void store.move(task.id, afterParentBranch, parent.depth);
    markSettled(task.id);
    setAnnouncement(`${task.title} moved to level ${parent.depth}`);
  }

  // rendering

  /**
   * Row the subtask composer sits under: the deepest row of the parent's branch
   * that is actually on screen, which is where the new task will appear.
   */
  const composerAfterId = useMemo(() => {
    if (!composerParent) return null;

    const start = store.tasks.findIndex((task) => task.id === composerParent.id);
    if (start === -1) return null;

    const end = start + descendantCount(store.tasks, start);
    const withinBranch = rows.filter((row) => row.index >= start && row.index <= end);

    return withinBranch[withinBranch.length - 1]?.task.id ?? null;
  }, [composerParent, rows, store.tasks]);

  function labelOf(id: string | number): string {
    return store.tasks.find((task) => task.id === String(id))?.title ?? 'the task';
  }

  const rowCallbacks = {
    onAddSubtask: (task: Task) => {
      setEditingId(null);
      // Opening it on a folded branch has to unfold it, or the input appears
      // detached from the row it belongs to.
      if (store.collapsedIds.has(task.id)) store.toggleCollapsed(task.id);
      setComposerParent(task);
    },
    onRename: (task: Task) => {
      setComposerParent(undefined);
      setEditingId(task.id);
    },
    onDelete: (task: Task) => setPendingDelete(task),
    onNudge: nudge,
    onShift: (task: Task, direction: -1 | 1) =>
      direction === -1 ? outdentRow(task) : indentRow(task),
  };

  if (store.isEmpty && composerParent === undefined) {
    return <EmptyState onAdd={() => setComposerParent(null)} />;
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              'Drag this handle with a pointer to move the task. To move it with the keyboard, ' +
              'focus the row instead and use the arrow keys with the Alt or Option key.',
          },
          announcements: {
            onDragStart: ({ active }) => `Picked up ${labelOf(active.id)}.`,
            onDragOver: () => undefined,
            onDragEnd: ({ active }) => `Dropped ${labelOf(active.id)}.`,
            onDragCancel: ({ active }) => `Cancelled. ${labelOf(active.id)} stayed where it was.`,
          },
        }}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDrag(null)}
      >
        <SortableContext
          items={draggable.map((row) => row.task.id)}
          strategy={verticalListSortingStrategy}
        >
          {/* TODO: windowing once trees get big. content-visibility is not an
              option here, it hides rows from the measuring dnd-kit does on
              drag start. */}
          <ul
            className={[styles.list, drag && styles.dragging].filter(Boolean).join(' ')}
            style={{ ['--indent' as string]: `${indent}px` }}
            aria-describedby="tree-instructions"
          >
            {draggable.map((row) => (
              <Fragment key={row.task.id}>
                <TaskRow
                  task={row.task}
                  hasChildren={row.hasChildren}
                  collapsed={row.collapsed}
                  subtaskCount={store.subtaskCount(row.task.id)}
                  projectedDepth={
                    drag?.id === row.task.id ? (projection?.depth ?? row.task.depth) : undefined
                  }
                  settled={settling === row.task.id}
                  editing={editingId === row.task.id}
                  onCommitRename={(task, title) => {
                    setEditingId(null);
                    void store.rename(task.id, title);
                  }}
                  onCancelRename={() => setEditingId(null)}
                  {...rowCallbacks}
                />

                {composerParent && composerAfterId === row.task.id && (
                  <ComposerRow
                    parent={composerParent}
                    onAdd={(title) => void store.create(composerParent.id, title)}
                    onClose={() => setComposerParent(undefined)}
                  />
                )}
              </Fragment>
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <AddTaskBar
        open={composerParent === null}
        onAdd={(title) => void store.create(null, title)}
        onOpen={() => {
          setEditingId(null);
          setComposerParent(null);
        }}
        onClose={() => setComposerParent(undefined)}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete “${pendingDelete?.title ?? ''}”?`}
        description={describeDeletion(pendingDelete ? store.subtaskCount(pendingDelete.id) : 0)}
        confirmLabel="Delete"
        onConfirm={() => {
          if (pendingDelete) void store.remove(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />

      <p id="tree-instructions" className="visually-hidden">
        Focus a task and hold {ALT_KEY_NAME} with the arrow keys to move it: up and down change
        its place in the list, left and right change how deeply it is nested. Press Enter to
        rename it.
      </p>

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>
    </>
  );
});

function describeDeletion(subtaskCount: number): string {
  if (subtaskCount === 0) return 'This task will be removed for good.';
  if (subtaskCount === 1) return 'Its subtask will be removed too.';
  return `Its ${subtaskCount} subtasks will be removed too.`;
}

function withoutDescendants(
  rows: readonly VisibleRow[],
  tasks: readonly Task[],
  id: string,
): VisibleRow[] {
  const index = tasks.findIndex((task) => task.id === id);
  if (index === -1) return [...rows];

  const hidden = new Set(branchIds(tasks, index).slice(1));
  return rows.filter((row) => !hidden.has(row.task.id));
}

function projectAt(
  rows: readonly VisibleRow[],
  activeIndex: number,
  id: string,
  offsetX: number,
  store: TaskStore,
  indentation: number,
): Projection | null {
  const origin = rows[activeIndex];
  if (!origin || origin.task.id !== id) return null;

  return project({
    rows,
    activeIndex,
    originDepth: origin.task.depth,
    height: store.heightOf(id),
    offsetX,
    indentation,
    limit: store.limits.maxDepth,
    total: store.tasks.length,
  });
}
