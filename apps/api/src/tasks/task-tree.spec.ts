import { buildTree, TaskRecord } from './task-tree';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function record(id: string, parentId: string | null, position: number, depth: number): TaskRecord {
  return { id, title: id, parentId, position, depth, createdAt: NOW, updatedAt: NOW };
}

describe('buildTree', () => {
  it('returns nothing for an empty result set', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('keeps roots in the order the query produced them', () => {
    const tree = buildTree([record('b', null, 0, 1), record('a', null, 1, 1)]);

    expect(tree.map((node) => node.id)).toEqual(['b', 'a']);
  });

  it('nests children under their parent', () => {
    const tree = buildTree([
      record('root', null, 0, 1),
      record('child', 'root', 0, 2),
      record('grandchild', 'child', 0, 3),
    ]);

    expect(tree).toHaveLength(1);
    expect(tree[0]!.children[0]!.id).toBe('child');
    expect(tree[0]!.children[0]!.children[0]!.id).toBe('grandchild');
  });

  it('preserves sibling order within a branch', () => {
    const tree = buildTree([
      record('root', null, 0, 1),
      record('first', 'root', 0, 2),
      record('second', 'root', 1, 2),
      record('third', 'root', 2, 2),
    ]);

    expect(tree[0]!.children.map((node) => node.id)).toEqual(['first', 'second', 'third']);
  });

  // The depth-first query always emits a parent before its children. Feeding it
  // rows in another order is a programming error, and quietly promoting the
  // orphan to a root would hide it.
  it('drops rows whose parent is missing from the input', () => {
    const tree = buildTree([record('orphan', 'absent', 0, 2)]);

    expect(tree).toEqual([]);
  });

  it('does not mutate the rows it was given', () => {
    const rows = [record('root', null, 0, 1)];
    const snapshot = { ...rows[0]! };

    buildTree(rows);

    expect(rows[0]).toEqual(snapshot);
  });
});
