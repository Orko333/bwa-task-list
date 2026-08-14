export interface TaskRecord {
  id: string;
  title: string;
  parentId: string | null;
  position: number;
  depth: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskNode extends TaskRecord {
  children: TaskNode[];
}

/**
 * Turns the depth-first row stream produced by {@link TasksRepository.findAllOrdered}
 * into a nested structure.
 *
 * The query guarantees a parent is emitted before any of its children, so a
 * single pass is enough: by the time a child shows up its parent is already in
 * the index. Rows whose parent is missing from the input are dropped rather than
 * silently promoted to roots; that can only happen if a caller passes a partial
 * result set.
 */
export function buildTree(rows: readonly TaskRecord[]): TaskNode[] {
  const index = new Map<string, TaskNode>();
  const roots: TaskNode[] = [];

  for (const row of rows) {
    const node: TaskNode = { ...row, children: [] };
    index.set(node.id, node);

    if (node.parentId === null) {
      roots.push(node);
      continue;
    }

    index.get(node.parentId)?.children.push(node);
  }

  return roots;
}
