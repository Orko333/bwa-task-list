import { describe, expect, it } from 'vitest';

import {
  branchHeight,
  branchIds,
  descendantCount,
  flattenTree,
  moveBranch,
  withRecalculatedPositions,
  type Task,
  type TaskNode,
} from './task';

/**
 * Builds a list from an outline, where leading spaces set the level:
 *   a
 *     b
 *   c
 */
function outline(source: string): Task[] {
  const lines = source.split('\n').filter((line) => line.trim().length > 0);
  const base = Math.min(...lines.map((line) => line.length - line.trimStart().length));
  const parents: string[] = [];

  return lines.map((line, index) => {
    const depth = (line.length - line.trimStart().length - base) / 2 + 1;
    const title = line.trim();

    parents[depth - 1] = title;

    return {
      id: title,
      title,
      parentId: depth === 1 ? null : (parents[depth - 2] ?? null),
      position: index,
      depth,
    };
  });
}

/** Renders a list back as an outline, so failures read like the UI. */
function render(tasks: readonly Task[]): string {
  return tasks.map((task) => `${'  '.repeat(task.depth - 1)}${task.title}`).join('\n');
}

function indexOf(tasks: readonly Task[], id: string): number {
  return tasks.findIndex((task) => task.id === id);
}

describe('flattenTree', () => {
  it('walks the tree depth first', () => {
    const tree: TaskNode[] = [
      {
        id: 'a',
        title: 'a',
        parentId: null,
        position: 0,
        depth: 1,
        children: [
          { id: 'a1', title: 'a1', parentId: 'a', position: 0, depth: 2, children: [] },
          { id: 'a2', title: 'a2', parentId: 'a', position: 1, depth: 2, children: [] },
        ],
      },
      { id: 'b', title: 'b', parentId: null, position: 1, depth: 1, children: [] },
    ];

    expect(flattenTree(tree).map((task) => task.id)).toEqual(['a', 'a1', 'a2', 'b']);
  });

  it('drops the children key from the rows it produces', () => {
    const tree: TaskNode[] = [
      { id: 'a', title: 'a', parentId: null, position: 0, depth: 1, children: [] },
    ];

    expect(flattenTree(tree)[0]).not.toHaveProperty('children');
  });
});

describe('descendantCount', () => {
  const tasks = outline(`
    a
      a1
        a1x
      a2
    b
  `);

  it.each([
    ['a', 3],
    ['a1', 1],
    ['a2', 0],
    ['b', 0],
  ])('counts the rows under %s', (id, expected) => {
    expect(descendantCount(tasks, indexOf(tasks, id))).toBe(expected);
  });

  it('returns zero for an index outside the list', () => {
    expect(descendantCount(tasks, 99)).toBe(0);
  });
});

describe('branchHeight', () => {
  const tasks = outline(`
    a
      a1
        a1x
    b
  `);

  it('measures how far the deepest leaf sits below the root of the branch', () => {
    expect(branchHeight(tasks, indexOf(tasks, 'a'))).toBe(2);
    expect(branchHeight(tasks, indexOf(tasks, 'a1'))).toBe(1);
    expect(branchHeight(tasks, indexOf(tasks, 'b'))).toBe(0);
  });
});

describe('branchIds', () => {
  it('lists the root together with everything under it', () => {
    const tasks = outline(`
      a
        a1
          a1x
      b
    `);

    expect(branchIds(tasks, indexOf(tasks, 'a'))).toEqual(['a', 'a1', 'a1x']);
  });
});

describe('withRecalculatedPositions', () => {
  it('numbers each sibling group from zero', () => {
    const tasks = outline(`
      a
        a1
        a2
      b
    `);

    const positions = withRecalculatedPositions(tasks).map((task) => [task.id, task.position]);

    expect(positions).toEqual([
      ['a', 0],
      ['a1', 0],
      ['a2', 1],
      ['b', 1],
    ]);
  });

  it('leaves untouched rows referentially equal, so React can skip them', () => {
    const tasks = withRecalculatedPositions(outline('a\nb'));

    expect(withRecalculatedPositions(tasks)[0]).toBe(tasks[0]);
  });
});

describe('moveBranch', () => {
  const tasks = outline(`
    a
      a1
        a1x
      a2
    b
      b1
    c
  `);

  it('reorders top-level rows', () => {
    const moved = moveBranch(tasks, indexOf(tasks, 'c'), indexOf(tasks, 'a'), 1);

    expect(render(moved)).toBe(
      ['c', 'a', '  a1', '    a1x', '  a2', 'b', '  b1'].join('\n'),
    );
  });

  it('carries the whole branch when its root moves', () => {
    const moved = moveBranch(tasks, indexOf(tasks, 'a1'), indexOf(tasks, 'c'), 2);

    expect(render(moved)).toBe(
      ['a', '  a2', 'b', '  b1', '  a1', '    a1x', 'c'].join('\n'),
    );
  });

  it('re-levels the branch and reassigns the parent of its root', () => {
    const moved = moveBranch(tasks, indexOf(tasks, 'a1'), tasks.length, 1);
    const a1 = moved.find((task) => task.id === 'a1');
    const a1x = moved.find((task) => task.id === 'a1x');

    expect(a1).toMatchObject({ depth: 1, parentId: null });
    expect(a1x).toMatchObject({ depth: 2, parentId: 'a1' });
  });

  it('adopts the closest preceding row one level up as the new parent', () => {
    const moved = moveBranch(tasks, indexOf(tasks, 'c'), indexOf(tasks, 'b1'), 2);

    expect(moved.find((task) => task.id === 'c')?.parentId).toBe('b');
    expect(render(moved)).toBe(
      ['a', '  a1', '    a1x', '  a2', 'b', '  c', '  b1'].join('\n'),
    );
  });

  it('moves a row to the very end when asked to insert past the list', () => {
    const moved = moveBranch(tasks, indexOf(tasks, 'a'), tasks.length, 1);

    expect(render(moved)).toBe(['b', '  b1', 'c', 'a', '  a1', '    a1x', '  a2'].join('\n'));
  });

  it('keeps positions dense in both the group it leaves and the one it joins', () => {
    const moved = moveBranch(tasks, indexOf(tasks, 'a2'), indexOf(tasks, 'b1'), 2);
    const groups = new Map<string | null, number[]>();

    moved.forEach((task) => {
      groups.set(task.parentId, [...(groups.get(task.parentId) ?? []), task.position]);
    });

    groups.forEach((positions) => {
      expect(positions).toEqual(positions.map((_, index) => index));
    });
  });

  it('is a no-op when the row is asked to stay where it is', () => {
    const index = indexOf(tasks, 'a2');
    const moved = moveBranch(tasks, index, index + 1, 2);

    expect(render(moved)).toBe(render(tasks));
  });

  it('returns a copy when the index does not exist', () => {
    const moved = moveBranch(tasks, 99, 0, 1);

    expect(moved).toEqual(tasks);
    expect(moved).not.toBe(tasks);
  });
});
