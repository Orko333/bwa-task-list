import { autorun, makeAutoObservable, observable, observableRef, runInAction } from 'mobx';

import { ApiError, type ApiErrorCode } from '../api/client';
import * as api from '../api/tasks';
import type { VisibleRow } from '../domain/projection';
import {
  branchHeight,
  branchIds,
  descendantCount,
  flattenTree,
  moveBranch,
  type Task,
} from '../domain/task';
import type { ToastStore } from './ToastStore';

export type LoadState = 'loading' | 'ready' | 'error';

const DEFAULT_LIMITS: api.ApiLimits = { maxDepth: 5, maxTitleLength: 200 };
const COLLAPSED_STORAGE_KEY = 'outline.collapsed';

export class TaskStore {
  /**
   * Every task in depth-first order. Held as a plain reference rather than a deep
   * observable: each operation swaps in a whole new array, so the previous one
   * doubles as the snapshot an optimistic update rolls back to.
   */
  tasks: Task[] = [];

  limits = DEFAULT_LIMITS;
  state: LoadState = 'loading';
  loadError: string | null = null;

  /** Branches the user has folded away. Kept across reloads. */
  collapsedIds = observable.set<string>(readCollapsed());
  /** Rows with an unfinished write; their controls stay disabled meanwhile. */
  pendingIds = observable.set<string>();

  /**
   * Bumped every time `tasks` is replaced. A response that comes back to a
   * different revision than the one it was computed against is stale, and
   * applying it would undo whatever landed in between.
   */
  private revision = 0;
  private readonly toasts: ToastStore;

  constructor(toasts: ToastStore) {
    this.toasts = toasts;
    makeAutoObservable<this, 'toasts' | 'revision'>(
      this,
      { tasks: observableRef, toasts: false, revision: false },
      { autoBind: true },
    );

    autorun(() => writeCollapsed(this.collapsedIds));
  }

  // derived state

  /** Rows the list renders: a collapsed branch contributes only its root. */
  get rows(): VisibleRow[] {
    const rows: VisibleRow[] = [];
    let hiddenBelow: number | null = null;

    this.tasks.forEach((task, index) => {
      if (hiddenBelow !== null) {
        if (task.depth > hiddenBelow) return;
        hiddenBelow = null;
      }

      const collapsed = this.collapsedIds.has(task.id);
      const hasChildren = this.tasks[index + 1]?.depth === task.depth + 1;

      rows.push({ task, index, hasChildren, collapsed });

      if (collapsed && hasChildren) hiddenBelow = task.depth;
    });

    return rows;
  }

  get isEmpty(): boolean {
    return this.state === 'ready' && this.tasks.length === 0;
  }

  get deepestLevel(): number {
    return this.tasks.reduce((deepest, task) => Math.max(deepest, task.depth), 0);
  }

  canHaveSubtasks(task: Task): boolean {
    return task.depth < this.limits.maxDepth;
  }

  isPending(id: string): boolean {
    return this.pendingIds.has(id);
  }

  // reading

  async load(): Promise<void> {
    runInAction(() => {
      this.state = 'loading';
      this.loadError = null;
    });

    try {
      const [tree, limits] = await Promise.all([api.fetchTasks(), api.fetchLimits()]);

      runInAction(() => {
        this.commit(flattenTree(tree));
        this.limits = limits;
        this.state = 'ready';
      });
    } catch (error) {
      runInAction(() => {
        this.loadError = messageOf(error);
        this.state = 'error';
      });
    }
  }

  // writing

  /**
   * Adds a task to the end of its sibling group.
   *
   * The row appears immediately under a temporary id and is swapped for the real
   * one when the server answers. The id has to come from the server, since it is
   * the primary key, so the placeholder is what keeps the list from stuttering
   * while the round trip is in flight.
   */
  async create(parentId: string | null, title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed) return;

    const parentIndex = parentId === null ? -1 : this.indexOf(parentId);
    if (parentId !== null && parentIndex === -1) return;

    const snapshot = this.tasks;
    const parent = this.tasks[parentIndex];
    const placeholderId = crypto.randomUUID();
    const placeholder: Task = {
      id: placeholderId,
      title: trimmed,
      parentId,
      position: 0,
      depth: parent ? parent.depth + 1 : 1,
    };

    const insertAt = parent
      ? parentIndex + descendantCount(this.tasks, parentIndex) + 1
      : this.tasks.length;

    let revision = 0;
    runInAction(() => {
      revision = this.commit([
        ...this.tasks.slice(0, insertAt),
        placeholder,
        ...this.tasks.slice(insertAt),
      ]);
      this.pendingIds.add(placeholderId);
      if (parentId !== null) this.collapsedIds.delete(parentId);
    });

    try {
      const created = await api.createTask(trimmed, parentId);

      if (this.revision !== revision) {
        // Something replaced the list while this was in flight, so the
        // placeholder is gone and there is nothing to patch. Drop it first in
        // case it survived, then take the server's word for the whole tree.
        this.dropPlaceholder(placeholderId);
        await this.resync();
        return;
      }

      runInAction(() => {
        this.commit(
          this.tasks.map((task) => (task.id === placeholderId ? { ...task, ...created } : task)),
        );
      });
    } catch (error) {
      this.dropPlaceholder(placeholderId);
      await this.revert(revision, snapshot, error, 'Could not add the task. Try again.');
    } finally {
      runInAction(() => this.pendingIds.delete(placeholderId));
    }
  }

  async rename(id: string, title: string): Promise<void> {
    const trimmed = title.trim();
    const current = this.tasks.find((task) => task.id === id);

    if (!current || !trimmed || trimmed === current.title) return;

    const snapshot = this.tasks;
    let revision = 0;

    runInAction(() => {
      revision = this.commit(
        this.tasks.map((task) => (task.id === id ? { ...task, title: trimmed } : task)),
      );
      this.pendingIds.add(id);
    });

    try {
      await api.renameTask(id, trimmed);
    } catch (error) {
      await this.revert(revision, snapshot, error, 'Could not rename the task. Try again.');
    } finally {
      runInAction(() => this.pendingIds.delete(id));
    }
  }

  async remove(id: string): Promise<void> {
    const index = this.indexOf(id);
    if (index === -1) return;

    const snapshot = this.tasks;
    const removed = new Set(branchIds(this.tasks, index));
    let revision = 0;

    runInAction(() => {
      revision = this.commit(this.tasks.filter((task) => !removed.has(task.id)));
      removed.forEach((taskId) => this.collapsedIds.delete(taskId));
      this.pendingIds.add(id);
    });

    try {
      await api.deleteTask(id);
    } catch (error) {
      await this.revert(revision, snapshot, error, 'Could not delete the task. Try again.');
    } finally {
      runInAction(() => this.pendingIds.delete(id));
    }
  }

  /**
   * Applies a drop.
   *
   * The new arrangement is computed locally first so the row settles where it was
   * dropped without waiting, then replaced by the tree the server returns. The
   * server is the one that renumbers positions across both sibling groups, so
   * taking its answer wholesale is what keeps the two in step.
   */
  async move(id: string, insertBeforeIndex: number, depth: number): Promise<void> {
    const index = this.indexOf(id);
    if (index === -1) return;

    const snapshot = this.tasks;
    const optimistic = moveBranch(this.tasks, index, insertBeforeIndex, depth);
    const moved = optimistic.find((task) => task.id === id);

    if (!moved || unchanged(snapshot, optimistic)) return;

    let revision = 0;
    runInAction(() => {
      revision = this.commit(optimistic);
      this.pendingIds.add(id);
      // Dropping into a folded branch has to open it, or the row the user just
      // placed vanishes on the way down.
      if (moved.parentId !== null) this.collapsedIds.delete(moved.parentId);
    });

    try {
      const tree = await api.moveTask(id, moved.parentId, moved.position);

      if (this.revision !== revision) {
        await this.resync();
        return;
      }

      runInAction(() => this.commit(flattenTree(tree)));
    } catch (error) {
      await this.revert(revision, snapshot, error, 'Could not move the task. Try again.');
    } finally {
      runInAction(() => this.pendingIds.delete(id));
    }
  }

  // view state

  toggleCollapsed(id: string): void {
    if (this.collapsedIds.has(id)) {
      this.collapsedIds.delete(id);
    } else {
      this.collapsedIds.add(id);
    }
  }

  heightOf(id: string): number {
    const index = this.indexOf(id);
    return index === -1 ? 0 : branchHeight(this.tasks, index);
  }

  subtaskCount(id: string): number {
    const index = this.indexOf(id);
    return index === -1 ? 0 : descendantCount(this.tasks, index);
  }

  /** Index of the row directly above `id` at the same level, or -1. */
  previousSiblingIndex(id: string): number {
    const index = this.indexOf(id);
    const task = this.tasks[index];
    if (!task) return -1;

    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = this.tasks[cursor]!;
      if (candidate.depth < task.depth) return -1;
      if (candidate.depth === task.depth) return cursor;
    }

    return -1;
  }

  // internals

  private indexOf(id: string): number {
    return this.tasks.findIndex((task) => task.id === id);
  }

  private commit(next: Task[]): number {
    this.tasks = next;
    this.revision += 1;
    return this.revision;
  }

  private dropPlaceholder(placeholderId: string): void {
    if (!this.tasks.some((task) => task.id === placeholderId)) return;
    runInAction(() => this.commit(this.tasks.filter((task) => task.id !== placeholderId)));
  }

  /**
   * Puts a failed write back.
   *
   * The snapshot only describes the truth while nothing else has changed since;
   * if another write landed in the meantime, restoring it would silently undo
   * that one too, so the list is re-read instead.
   *
   * A 404 means the row is already gone on the server, so the snapshot is wrong
   * whatever the revision says and the tree is re-read as well.
   */
  private async revert(
    revision: number,
    snapshot: Task[],
    error: unknown,
    fallback: string,
  ): Promise<void> {
    this.toasts.show('error', messageOf(error, fallback));

    const gone = error instanceof ApiError && isMissingOnServer(error.code);

    if (this.revision === revision && !gone) {
      runInAction(() => this.commit(snapshot));
      return;
    }

    await this.resync();
  }

  /**
   * Re-reads the tree without emptying the screen first.
   *
   * The result is dropped if a write landed while the request was open: that
   * write knows more than this snapshot does, and its own settle path will
   * reconcile.
   */
  private async resync(): Promise<void> {
    const revision = this.revision;

    try {
      const tree = await api.fetchTasks();
      if (this.revision !== revision) return;

      runInAction(() => this.commit(flattenTree(tree)));
    } catch {
      // Leave what is on screen. The next write or a reload will correct it.
    }
  }
}

function unchanged(before: readonly Task[], after: readonly Task[]): boolean {
  return before.every(
    (task, index) =>
      after[index]?.id === task.id &&
      after[index]?.depth === task.depth &&
      after[index]?.parentId === task.parentId,
  );
}

function messageOf(error: unknown, fallback = 'Something went wrong.'): string {
  return error instanceof ApiError ? error.message : fallback;
}

/** The row this write was about is not on the server any more. */
function isMissingOnServer(code: ApiErrorCode | null): boolean {
  return code === 'TASK_NOT_FOUND' || code === 'PARENT_NOT_FOUND';
}

/**
 * Which branches are folded is a view preference, not data, so it stays on the
 * device instead of going to the server. Storage can be unavailable (private
 * mode, a blocked origin) and losing it is harmless, so failures are swallowed.
 */
function readCollapsed(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(COLLAPSED_STORAGE_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeCollapsed(ids: ReadonlySet<string>): void {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    // Nothing to do. The tree simply opens fully on the next visit.
  }
}
