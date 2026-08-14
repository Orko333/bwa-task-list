import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../api/client';
import * as api from '../api/tasks';
import type { TaskNode } from '../domain/task';
import { TaskStore } from './TaskStore';
import { ToastStore } from './ToastStore';

vi.mock('../api/tasks');

const mocked = vi.mocked(api);

function node(id: string, depth: number, parentId: string | null, children: TaskNode[] = []) {
  return { id, title: id, parentId, position: 0, depth, children };
}

/** a > a1 > a1x, then b. Enough shape to move a branch around. */
function sampleTree(): TaskNode[] {
  return [
    node('a', 1, null, [node('a1', 2, 'a', [node('a1x', 3, 'a1')])]),
    node('b', 1, null),
  ];
}

async function readyStore(): Promise<{ store: TaskStore; toasts: ToastStore }> {
  const toasts = new ToastStore();
  const store = new TaskStore(toasts);

  mocked.fetchTasks.mockResolvedValue(sampleTree());
  mocked.fetchLimits.mockResolvedValue({ maxDepth: 5, maxTitleLength: 200 });
  await store.load();

  return { store, toasts };
}

function outline(store: TaskStore): string[] {
  return store.tasks.map((task) => `${'  '.repeat(task.depth - 1)}${task.title}`);
}

beforeEach(() => {
  vi.resetAllMocks();
  // Collapsed branches persist to localStorage, so each case starts from clean.
  localStorage.clear();
});

describe('TaskStore.load', () => {
  it('flattens the tree the API returns', async () => {
    const { store } = await readyStore();

    expect(store.state).toBe('ready');
    expect(outline(store)).toEqual(['a', '  a1', '    a1x', 'b']);
  });

  it('reports a failure instead of showing an empty list', async () => {
    const store = new TaskStore(new ToastStore());
    mocked.fetchTasks.mockRejectedValue(new ApiError('Cannot reach the server.', null, null));
    mocked.fetchLimits.mockResolvedValue({ maxDepth: 5, maxTitleLength: 200 });

    await store.load();

    expect(store.state).toBe('error');
    expect(store.loadError).toBe('Cannot reach the server.');
    expect(store.isEmpty).toBe(false);
  });
});

describe('TaskStore.rows', () => {
  it('hides the branch under a collapsed row', async () => {
    const { store } = await readyStore();

    store.toggleCollapsed('a1');

    expect(store.rows.map((row) => row.task.id)).toEqual(['a', 'a1', 'b']);
    expect(store.rows.find((row) => row.task.id === 'a1')).toMatchObject({
      hasChildren: true,
      collapsed: true,
    });
  });

  it('keeps the index of each row in the full list, so drops stay accurate', async () => {
    const { store } = await readyStore();

    store.toggleCollapsed('a1');

    expect(store.rows.map((row) => row.index)).toEqual([0, 1, 3]);
  });

  it('remembers which branches were folded away', async () => {
    const { store } = await readyStore();
    store.toggleCollapsed('a1');

    const reopened = new TaskStore(new ToastStore());
    mocked.fetchTasks.mockResolvedValue(sampleTree());
    mocked.fetchLimits.mockResolvedValue({ maxDepth: 5, maxTitleLength: 200 });
    await reopened.load();

    expect(reopened.rows.map((row) => row.task.id)).toEqual(['a', 'a1', 'b']);
  });
});

describe('TaskStore.create', () => {
  it('shows the task before the server answers, then adopts the real id', async () => {
    const { store } = await readyStore();
    let resolve: (task: TaskNode) => void = () => {};
    mocked.createTask.mockReturnValue(
      new Promise<TaskNode>((done) => {
        resolve = done;
      }),
    );

    const pending = store.create('a', 'new subtask');

    expect(outline(store)).toEqual(['a', '  a1', '    a1x', '  new subtask', 'b']);
    const placeholder = store.tasks[3]!;
    expect(store.isPending(placeholder.id)).toBe(true);

    resolve(node('server-id', 2, 'a'));
    await pending;

    expect(store.tasks[3]!.id).toBe('server-id');
    expect(store.isPending('server-id')).toBe(false);
  });

  it('takes the row back and explains why when the request fails', async () => {
    const { store, toasts } = await readyStore();
    mocked.createTask.mockRejectedValue(new ApiError('The change was rejected.', 400, null));

    await store.create(null, 'doomed');

    expect(outline(store)).toEqual(['a', '  a1', '    a1x', 'b']);
    expect(toasts.items[0]).toMatchObject({
      tone: 'error',
      message: 'The change was rejected.',
    });
  });

  it('ignores a blank title', async () => {
    const { store } = await readyStore();

    await store.create(null, '   ');

    expect(mocked.createTask).not.toHaveBeenCalled();
  });
});

describe('TaskStore.rename', () => {
  it('rolls the old title back when the request fails', async () => {
    const { store, toasts } = await readyStore();
    mocked.renameTask.mockRejectedValue(new ApiError('Task a does not exist', 404, 'TASK_NOT_FOUND'));

    await store.rename('a', 'renamed');

    expect(store.tasks[0]!.title).toBe('a');
    expect(toasts.items).toHaveLength(1);
  });

  it('does not call the API for a no-op rename', async () => {
    const { store } = await readyStore();

    await store.rename('a', '  a  ');

    expect(mocked.renameTask).not.toHaveBeenCalled();
  });
});

describe('TaskStore.remove', () => {
  it('deletes the branch, not just the row', async () => {
    const { store } = await readyStore();
    mocked.deleteTask.mockResolvedValue();

    await store.remove('a');

    expect(outline(store)).toEqual(['b']);
  });

  it('restores the branch when the request fails', async () => {
    const { store } = await readyStore();
    mocked.deleteTask.mockRejectedValue(new ApiError('The server ran into a problem.', 500, null));

    await store.remove('a');

    expect(outline(store)).toEqual(['a', '  a1', '    a1x', 'b']);
  });
});

describe('TaskStore.move', () => {
  it('settles the row locally, then takes the tree the server returns', async () => {
    const { store } = await readyStore();
    mocked.moveTask.mockResolvedValue([
      node('b', 1, null, [node('a', 2, 'b', [node('a1', 3, 'b'), node('a1x', 4, 'a1')])]),
    ]);

    // Move `a` and its branch to the end of the list, at the top level.
    const pending = store.move('a', store.tasks.length, 1);
    expect(outline(store)).toEqual(['b', 'a', '  a1', '    a1x']);

    await pending;
    expect(outline(store)).toEqual(['b', '  a', '    a1', '      a1x']);
  });

  it('sends the position the row ends up at within its new group', async () => {
    const { store } = await readyStore();
    mocked.moveTask.mockResolvedValue(sampleTree());

    await store.move('b', 0, 1);

    expect(mocked.moveTask).toHaveBeenCalledWith('b', null, 0);
  });

  it('puts the tree back and explains why when the server refuses', async () => {
    const { store, toasts } = await readyStore();
    mocked.moveTask.mockRejectedValue(
      new ApiError('This would place a task on level 6', 422, 'MAX_DEPTH_EXCEEDED'),
    );

    await store.move('a', store.tasks.length, 1);

    expect(outline(store)).toEqual(['a', '  a1', '    a1x', 'b']);
    expect(toasts.items[0]?.message).toContain('level 6');
  });

  it('does not call the API when the drop changes nothing', async () => {
    const { store } = await readyStore();

    await store.move('a1', 2, 2);

    expect(mocked.moveTask).not.toHaveBeenCalled();
  });

  it('opens a folded destination so the row does not vanish on arrival', async () => {
    const { store } = await readyStore();
    store.toggleCollapsed('a1');
    mocked.moveTask.mockResolvedValue(sampleTree());

    // b joins a1's folded branch.
    await store.move('b', 3, 3);

    expect(store.collapsedIds.has('a1')).toBe(false);
  });
});

// A response is only safe to apply to the list it was computed against. These
// cover the window where a second write lands while the first is in flight.
describe('TaskStore under overlapping writes', () => {
  it('re-reads instead of restoring a snapshot that a later write has outdated', async () => {
    const { store } = await readyStore();

    let failRename: (error: Error) => void = () => {};
    mocked.renameTask.mockReturnValue(
      new Promise((_, reject) => {
        failRename = reject;
      }),
    );
    mocked.deleteTask.mockResolvedValue();
    mocked.fetchTasks.mockResolvedValue([node('server-truth', 1, null)]);

    const renaming = store.rename('a', 'renamed');
    await store.remove('b');

    failRename(new ApiError('The server ran into a problem.', 500, null));
    await renaming;

    // Restoring the pre-rename snapshot would have brought `b` back from the dead.
    expect(outline(store)).toEqual(['server-truth']);
  });

  it('re-reads when the placeholder it was going to patch is already gone', async () => {
    const { store } = await readyStore();

    let finishCreate: (task: TaskNode) => void = () => {};
    mocked.createTask.mockReturnValue(
      new Promise((resolve) => {
        finishCreate = resolve;
      }),
    );
    mocked.moveTask.mockResolvedValue([node('after-move', 1, null)]);
    mocked.fetchTasks.mockResolvedValue([node('after-move', 1, null), node('created', 1, null)]);

    const creating = store.create(null, 'new task');
    await store.move('a', store.tasks.length, 1);

    finishCreate(node('created', 1, null));
    await creating;

    expect(outline(store)).toEqual(['after-move', 'created']);
  });
});
