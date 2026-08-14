import { Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';
import { TaskRecord } from './task-tree';

/**
 * Either the root client or the client bound to an open interactive transaction.
 * Every method takes one so the caller decides the transaction boundary.
 */
export type Db = PrismaService | Prisma.TransactionClient;

/**
 * Data access for the task tree.
 *
 * Ordinary reads and writes go through the Prisma query builder. Raw SQL is used
 * only where it earns its place: recursive walks of the tree, row locks, and the
 * bulk position/depth updates that would otherwise turn into a round trip per
 * row.
 *
 * `IS NOT DISTINCT FROM` shows up in every sibling query because a sibling group
 * is keyed by `parent_id`, which is NULL for roots, and plain `=` never matches
 * those.
 */
@Injectable()
export class TasksRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every task in depth-first order.
   *
   * `sort_path` accumulates the position of each ancestor, so ordering by it
   * reproduces exactly the order the tree is rendered in. Doing this in SQL keeps
   * the API layer to a single linear pass over the result.
   */
  findAllOrdered(db: Db = this.prisma): Promise<TaskRecord[]> {
    return db.$queryRaw<TaskRecord[]>`
      WITH RECURSIVE tree AS (
        SELECT t.*, ARRAY[t.position] AS sort_path
        FROM tasks t
        WHERE t.parent_id IS NULL

        UNION ALL

        SELECT child.*, parent.sort_path || child.position
        FROM tasks child
        JOIN tree parent ON child.parent_id = parent.id
      )
      SELECT
        id,
        title,
        parent_id AS "parentId",
        position,
        depth,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM tree
      ORDER BY sort_path
    `;
  }

  /**
   * Serialises every write that touches the given sibling groups.
   *
   * A transaction-scoped advisory lock rather than `SELECT ... FOR UPDATE`,
   * because an append has to be held off even when the group is still empty and
   * there are no rows to lock. Keys are sorted so two writers that need the same
   * pair of groups always take them in the same order and cannot deadlock.
   */
  async lockGroups(parentIds: readonly (string | null)[], db: Db): Promise<void> {
    const keys = [...new Set(parentIds.map((id) => id ?? 'root'))].sort();

    for (const key of keys) {
      // $executeRaw, not $queryRaw: the lock function returns void and the
      // driver has no decoder for it.
      await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}::text, 0))`;
    }
  }

  /** Holds specific rows for the rest of the transaction. */
  async lockRows(ids: readonly (string | null)[], db: Db): Promise<void> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))].sort();
    if (unique.length === 0) return;

    await db.$executeRaw`
      SELECT id FROM tasks WHERE id = ANY(${unique}::uuid[]) ORDER BY id FOR UPDATE
    `;
  }

  /**
   * Holds every row of the branch being moved, plus the destination parent.
   *
   * The branch matters as a whole, not just at its root: a move measures how
   * tall the branch is and then re-levels every row in it, so a task appended
   * anywhere inside it meanwhile would be measured out of the decision and
   * re-levelled past the limit anyway. Locking the destination parent in the
   * same statement pins the depth the move is about to inherit from it.
   *
   * One id-ordered statement, so two movers whose branches overlap always take
   * the shared rows in the same order.
   */
  async lockBranchForMove(taskId: string, targetParentId: string | null, db: Db): Promise<void> {
    await db.$executeRaw`
      WITH RECURSIVE subtree AS (
        SELECT id FROM tasks WHERE id = ${taskId}::uuid

        UNION ALL

        SELECT child.id
        FROM tasks child
        JOIN subtree parent ON child.parent_id = parent.id
      )
      SELECT locked.id
      FROM tasks locked
      WHERE locked.id IN (SELECT id FROM subtree)
         OR locked.id = ${targetParentId}::uuid
      ORDER BY locked.id
      FOR UPDATE
    `;
  }

  findById(id: string, db: Db = this.prisma): Promise<TaskRecord | null> {
    return db.task.findUnique({ where: { id } });
  }

  countChildren(parentId: string | null, db: Db = this.prisma): Promise<number> {
    return db.task.count({ where: { parentId } });
  }

  /**
   * Walks the subtree rooted at `taskId` once and answers both questions a move
   * needs: how tall the branch is, and whether the proposed parent lives inside
   * it. Height 0 means the task has no children.
   */
  async inspectSubtree(
    taskId: string,
    candidateParentId: string | null,
    db: Db,
  ): Promise<{ height: number; containsCandidate: boolean }> {
    const rows = await db.$queryRaw<{ height: number; containsCandidate: boolean | null }[]>`
      WITH RECURSIVE subtree AS (
        SELECT id, 0 AS relative_depth
        FROM tasks
        WHERE id = ${taskId}::uuid

        UNION ALL

        SELECT child.id, parent.relative_depth + 1
        FROM tasks child
        JOIN subtree parent ON child.parent_id = parent.id
      )
      SELECT
        COALESCE(MAX(relative_depth), 0)::int AS height,
        BOOL_OR(id = ${candidateParentId}::uuid) AS "containsCandidate"
      FROM subtree
    `;

    const row = rows[0];
    return {
      height: row?.height ?? 0,
      containsCandidate: row?.containsCandidate === true,
    };
  }

  /** Closes the hole a task leaves behind when it moves out of a sibling group. */
  async closeGap(parentId: string | null, position: number, db: Db): Promise<void> {
    await db.$executeRaw`
      UPDATE tasks
      SET position = position - 1, updated_at = NOW()
      WHERE parent_id IS NOT DISTINCT FROM ${parentId}::uuid
        AND position > ${position}
    `;
  }

  /** Opens a slot at `position` in a sibling group, ignoring the task being moved. */
  async openGap(
    parentId: string | null,
    position: number,
    excludedTaskId: string,
    db: Db,
  ): Promise<void> {
    await db.$executeRaw`
      UPDATE tasks
      SET position = position + 1, updated_at = NOW()
      WHERE parent_id IS NOT DISTINCT FROM ${parentId}::uuid
        AND position >= ${position}
        AND id <> ${excludedTaskId}::uuid
    `;
  }

  async place(
    taskId: string,
    parentId: string | null,
    position: number,
    depth: number,
    db: Db,
  ): Promise<void> {
    await db.task.update({
      where: { id: taskId },
      data: { parentId, position, depth },
    });
  }

  /**
   * Applies the same depth delta to every descendant of `taskId` (the task itself
   * is excluded, since `place` has already set its depth).
   *
   * One statement rather than a walk. The `depth` check constraint is evaluated
   * per row, so validating the delta before calling this is what keeps every
   * touched row inside the allowed range.
   */
  async shiftDescendantDepth(taskId: string, delta: number, db: Db): Promise<void> {
    if (delta === 0) return;

    await db.$executeRaw`
      WITH RECURSIVE subtree AS (
        SELECT id FROM tasks WHERE parent_id = ${taskId}::uuid

        UNION ALL

        SELECT child.id
        FROM tasks child
        JOIN subtree parent ON child.parent_id = parent.id
      )
      UPDATE tasks
      SET depth = depth + ${delta}, updated_at = NOW()
      WHERE id IN (SELECT id FROM subtree)
    `;
  }

  /**
   * Rewrites a sibling group to a dense 0..n-1 sequence, preserving the order
   * the rows are already in.
   *
   * Used after a delete. An incremental shift would do the same job in the happy
   * path, but this restores a clean sequence whatever state the group was left
   * in, which is worth the single extra statement on a rare operation.
   */
  async resequence(parentId: string | null, db: Db): Promise<void> {
    await db.$executeRaw`
      UPDATE tasks target
      SET position = ordered.rank - 1, updated_at = NOW()
      FROM (
        SELECT id, ROW_NUMBER() OVER (ORDER BY position, created_at, id) AS rank
        FROM tasks
        WHERE parent_id IS NOT DISTINCT FROM ${parentId}::uuid
      ) ordered
      WHERE target.id = ordered.id
        AND target.position <> ordered.rank - 1
    `;
  }

  /**
   * Appends a task to the end of its sibling group in one statement.
   *
   * Reading the group's size and then inserting would be two steps, and at
   * SERIALIZABLE two of those interleaving is a conflict every time. Computing
   * the position inside the INSERT leaves nothing to interleave.
   */
  async append(
    data: { title: string; parentId: string | null; depth: number },
    db: Db,
  ): Promise<TaskRecord> {
    const rows = await db.$queryRaw<TaskRecord[]>`
      INSERT INTO tasks (id, title, parent_id, position, depth, created_at, updated_at)
      SELECT
        gen_random_uuid(),
        ${data.title},
        ${data.parentId}::uuid,
        COALESCE(MAX(position) + 1, 0),
        ${data.depth},
        NOW(),
        NOW()
      FROM tasks
      WHERE parent_id IS NOT DISTINCT FROM ${data.parentId}::uuid
      RETURNING
        id,
        title,
        parent_id AS "parentId",
        position,
        depth,
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `;

    return rows[0]!;
  }

  rename(id: string, title: string, db: Db = this.prisma): Promise<TaskRecord> {
    return db.task.update({ where: { id }, data: { title } });
  }

  /** Deletes the task; descendants go with it through `ON DELETE CASCADE`. */
  async delete(id: string, db: Db): Promise<void> {
    await db.task.delete({ where: { id } });
  }

  async deleteAll(db: Db = this.prisma): Promise<void> {
    await db.$executeRaw`TRUNCATE TABLE tasks RESTART IDENTITY CASCADE`;
  }
}
