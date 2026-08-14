export interface Task {
  id: string;
  title: string;
  parentId: string | null;
  position: number;
  depth: number;
}

/** Shape the API returns: subtasks nested under their parent. */
export interface TaskNode extends Task {
  children: TaskNode[];
}

/**
 * The app keeps tasks as a flat array in depth-first order, the same order they
 * appear on screen. Rendering, sorting and dragging all work on a list, so
 * storing a list removes a conversion step from each of them, and the `depth` on
 * every row carries the structure the nesting would otherwise hold.
 */
export function flattenTree(nodes: readonly TaskNode[]): Task[] {
  return nodes.flatMap(({ children, ...task }) => [task, ...flattenTree(children)]);
}

/**
 * Number of rows belonging to the branch that starts at `index`. In depth-first
 * order the descendants are exactly the rows that follow it while staying
 * deeper than it.
 */
export function descendantCount(tasks: readonly Task[], index: number): number {
  const root = tasks[index];
  if (!root) return 0;

  let count = 0;
  while (index + count + 1 < tasks.length && tasks[index + count + 1]!.depth > root.depth) {
    count += 1;
  }

  return count;
}

/** How many levels the branch at `index` occupies below its own row. */
export function branchHeight(tasks: readonly Task[], index: number): number {
  const root = tasks[index];
  if (!root) return 0;

  const branch = tasks.slice(index, index + descendantCount(tasks, index) + 1);
  return Math.max(...branch.map((task) => task.depth)) - root.depth;
}

/** Ids of every row inside the branch at `index`, the root included. */
export function branchIds(tasks: readonly Task[], index: number): string[] {
  return tasks.slice(index, index + descendantCount(tasks, index) + 1).map((task) => task.id);
}

/**
 * Rewrites `position` so every sibling group runs 0..n-1 in the order the rows
 * already appear. Depth-first order means a group's members are met in their own
 * order even when other branches sit between them.
 */
export function withRecalculatedPositions(tasks: readonly Task[]): Task[] {
  const nextPosition = new Map<string | null, number>();

  return tasks.map((task) => {
    const position = nextPosition.get(task.parentId) ?? 0;
    nextPosition.set(task.parentId, position + 1);

    return task.position === position ? task : { ...task, position };
  });
}

/**
 * Moves the branch at `fromIndex` so its root row lands directly before
 * `insertBeforeIndex`, at level `depth`. Pass `tasks.length` to move it to the
 * end.
 *
 * The new parent is the closest preceding row one level shallower, which is what
 * gives the sideways part of a drag its meaning: the same drop slot yields a
 * different parent depending on how far right the pointer travelled.
 */
export function moveBranch(
  tasks: readonly Task[],
  fromIndex: number,
  insertBeforeIndex: number,
  depth: number,
): Task[] {
  const root = tasks[fromIndex];
  if (!root) return [...tasks];

  const branchLength = descendantCount(tasks, fromIndex) + 1;
  const branch = tasks.slice(fromIndex, fromIndex + branchLength);
  const rest = [...tasks.slice(0, fromIndex), ...tasks.slice(fromIndex + branchLength)];

  // `insertBeforeIndex` points into the original array; shift it back over the
  // rows the branch used to occupy.
  const insertAt =
    insertBeforeIndex >= fromIndex + branchLength
      ? insertBeforeIndex - branchLength
      : Math.min(insertBeforeIndex, fromIndex);

  const shift = depth - root.depth;
  const parentId = findParentId(rest, insertAt, depth);

  const relocated = branch.map((task, offset) => ({
    ...task,
    depth: task.depth + shift,
    parentId: offset === 0 ? parentId : task.parentId,
  }));

  return withRecalculatedPositions([
    ...rest.slice(0, insertAt),
    ...relocated,
    ...rest.slice(insertAt),
  ]);
}

/** Closest row before `index` that sits one level above `depth`. */
function findParentId(tasks: readonly Task[], index: number, depth: number): string | null {
  if (depth <= 1) return null;

  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = tasks[cursor]!;
    if (candidate.depth === depth - 1) return candidate.id;
  }

  return null;
}
