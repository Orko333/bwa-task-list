import type { Task } from './task';

/** A row as the list renders it: collapsed branches contribute only their root. */
export interface VisibleRow {
  task: Task;
  /** Index of the row in the full depth-first array. */
  index: number;
  hasChildren: boolean;
  collapsed: boolean;
}

export interface Projection {
  depth: number;
  /** Index into the full array of the row the branch lands before. */
  insertBeforeIndex: number;
  minDepth: number;
  maxDepth: number;
}

export interface ProjectionInput {
  /** Rows as rendered mid-drag, already reordered to the drop slot. */
  rows: readonly VisibleRow[];
  activeIndex: number;
  /** Level the dragged row started on. */
  originDepth: number;
  /** How many levels hang below the dragged row. */
  height: number;
  /** Horizontal travel since the drag began, in pixels. */
  offsetX: number;
  indentation: number;
  /** Deepest level the API accepts. */
  limit: number;
  /** Length of the full array, used when the drop is at the very end. */
  total: number;
}

/**
 * Works out where a dragged branch would land.
 *
 * Vertical position comes from the sortable list, which has already reordered
 * the rows around the pointer. This function only resolves the horizontal axis:
 * how far right the pointer travelled decides how deep the branch nests, bounded
 * by what the neighbouring rows allow.
 *
 * The row above sets the ceiling, since a branch can go at most one level below
 * it, and the row below sets the floor, because nesting shallower than the
 * following row would orphan it. The nesting limit lowers the ceiling further for a tall
 * branch: only the levels its own subtree still fits into are offered.
 */
export function project(input: ProjectionInput): Projection | null {
  const { rows, activeIndex, originDepth, height, offsetX, indentation, limit, total } = input;

  const previous = rows[activeIndex - 1];
  const next = rows[activeIndex + 1];

  const ceiling = previous ? previous.task.depth + 1 : 1;
  const floor = next ? next.task.depth : 1;

  const maxDepth = Math.max(Math.min(ceiling, limit - height), 1);
  const minDepth = Math.max(floor, 1);

  // A branch too tall for this slot has nowhere legal to land: every level that
  // would keep its leaves inside the limit is shallower than the row below, and
  // landing there would quietly adopt that row. Refuse the slot instead.
  if (minDepth > maxDepth) return null;

  const requested = originDepth + Math.round(offsetX / indentation);
  const depth = Math.min(Math.max(requested, minDepth), maxDepth);

  return {
    depth,
    // Anchored on the following row, not the preceding one: that keeps whatever
    // is folded away under the row above on its own side of the insertion point.
    insertBeforeIndex: next ? next.index : total,
    minDepth,
    maxDepth,
  };
}
