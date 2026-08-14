import { describe, expect, it } from 'vitest';

import { project, type VisibleRow } from './projection';
import type { Task } from './task';

const INDENT = 26;

function rows(...depths: number[]): VisibleRow[] {
  return depths.map((depth, index) => ({
    task: { id: `t${index}`, title: `t${index}`, parentId: null, position: index, depth } as Task,
    index,
    hasChildren: false,
    collapsed: false,
  }));
}

function projectAt(
  visible: VisibleRow[],
  activeIndex: number,
  offsetX: number,
  options: { height?: number; limit?: number } = {},
) {
  return project({
    rows: visible,
    activeIndex,
    originDepth: visible[activeIndex]!.task.depth,
    height: options.height ?? 0,
    offsetX,
    indentation: INDENT,
    limit: options.limit ?? 5,
    total: visible.length,
  });
}

describe('project', () => {
  it('keeps the level when the pointer has not travelled sideways', () => {
    // t0 / t1(child) / t2, dropping t1 in place with no horizontal movement.
    expect(projectAt(rows(1, 2, 2), 1, 0)?.depth).toBe(2);
  });

  it('nests one level for each indentation step dragged right', () => {
    expect(projectAt(rows(1, 1, 1), 1, INDENT)?.depth).toBe(2);
  });

  it('lifts a level for each step dragged left', () => {
    expect(projectAt(rows(1, 2, 1), 1, -INDENT)?.depth).toBe(1);
  });

  it('rounds a half step to the nearer level', () => {
    expect(projectAt(rows(1, 1, 1), 1, INDENT * 0.4)?.depth).toBe(1);
    expect(projectAt(rows(1, 1, 1), 1, INDENT * 0.6)?.depth).toBe(2);
  });

  // A row can be at most one level below the row above it; anything deeper would
  // have no parent to attach to.
  it('never nests more than one level below the row above', () => {
    expect(projectAt(rows(1, 1, 1), 1, INDENT * 5)?.depth).toBe(2);
  });

  // Dropped above everything else there is no row to hang from, however far
  // right the pointer went.
  it('puts the first row of the list at the top level', () => {
    expect(projectAt(rows(3, 1, 2), 0, INDENT * 3)?.depth).toBe(1);
  });

  // Lifting above the following row would silently re-parent it under the row
  // being dragged, which is never what the gesture meant.
  it('never lifts above the row below', () => {
    expect(projectAt(rows(1, 2, 2), 1, -INDENT * 4)?.depth).toBe(2);
  });

  // Every level shallow enough to keep the branch's leaves inside the limit
  // would adopt the row below, so the slot has to refuse the drop outright
  // rather than pick the least bad option.
  it('refuses a slot where no level satisfies both the limit and the row below', () => {
    expect(projectAt(rows(3, 1, 4), 1, 0, { height: 2, limit: 5 })).toBeNull();
  });

  it('stops at the nesting limit', () => {
    expect(projectAt(rows(4, 4), 1, INDENT * 3, { limit: 5 })?.depth).toBe(5);
  });

  // The limit applies to the deepest leaf of the branch, not to its root.
  it('reserves room for the rows hanging below the dragged one', () => {
    expect(projectAt(rows(4, 1), 1, INDENT * 3, { height: 2, limit: 5 })?.depth).toBe(3);
  });

  it('reports the levels the current slot allows', () => {
    const projection = projectAt(rows(2, 1, 1), 1, 0);

    expect(projection).toMatchObject({ minDepth: 1, maxDepth: 3 });
  });

  it('anchors the insertion point on the row below the slot', () => {
    expect(projectAt(rows(1, 1, 1), 1, 0)?.insertBeforeIndex).toBe(2);
  });

  it('inserts at the end of the list when the slot is the last one', () => {
    expect(projectAt(rows(1, 1, 1), 2, 0)?.insertBeforeIndex).toBe(3);
  });
});
