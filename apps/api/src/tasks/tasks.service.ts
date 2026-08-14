import { Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { buildTree, TaskNode, TaskRecord } from './task-tree';
import { MAX_DEPTH } from './tasks.constants';
import {
  CyclicMoveException,
  MaxDepthExceededException,
  ParentNotFoundException,
  TaskNotFoundException,
} from './tasks.errors';
import { Db, TasksRepository } from './tasks.repository';

const MAX_TRANSACTION_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 25;

/** serialization_failure and deadlock_detected. */
const RETRYABLE_SQLSTATES = new Set(['40001', '40P01']);

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksRepository,
  ) {}

  async findTree(): Promise<TaskNode[]> {
    return buildTree(await this.tasks.findAllOrdered());
  }

  /** Appends a task to the end of its sibling group. */
  async create(dto: CreateTaskDto): Promise<TaskRecord> {
    const parentId = dto.parentId ?? null;

    return this.transaction(async (tx) => {
      // The group lock orders writers within the sibling group; the row lock
      // pins the parent itself, whose depth the new task inherits and which a
      // concurrent move of that parent would otherwise change underneath us.
      await this.tasks.lockGroups([parentId], tx);
      await this.tasks.lockRows([parentId], tx);

      const depth = (await this.resolveParentDepth(parentId, tx)) + 1;
      if (depth > MAX_DEPTH) {
        throw new MaxDepthExceededException(depth);
      }

      return this.tasks.append({ title: dto.title, parentId, depth }, tx);
    });
  }

  async rename(id: string, dto: UpdateTaskDto): Promise<TaskRecord> {
    try {
      return await this.tasks.rename(id, dto.title);
    } catch (error) {
      if (isMissingRecord(error)) throw new TaskNotFoundException();
      throw error;
    }
  }

  /**
   * Removes a task together with its subtree and closes the gap it leaves in its
   * sibling group.
   */
  async remove(id: string): Promise<void> {
    await this.transaction(async (tx) => {
      const observed = await this.tasks.findById(id, tx);
      if (!observed) throw new TaskNotFoundException();

      // The first read is unlocked, so the row may have moved between reading it
      // and locking its group. Re-read under the lock and take the group it
      // actually belongs to now.
      await this.tasks.lockGroups([observed.parentId], tx);
      const task = await this.tasks.findById(id, tx);
      if (!task) throw new TaskNotFoundException();

      if (task.parentId !== observed.parentId) {
        await this.tasks.lockGroups([task.parentId], tx);
      }

      await this.tasks.delete(id, tx);
      await this.tasks.resequence(task.parentId, tx);
    });
  }

  /**
   * Re-parents a task and/or changes its order among siblings, then returns the
   * whole tree.
   *
   * A single move renumbers an arbitrary number of siblings in two groups and
   * rewrites the depth of a whole branch, so handing the client the resulting
   * tree is both cheaper and less error-prone than having it replay the same
   * bookkeeping locally.
   */
  async move(id: string, dto: MoveTaskDto): Promise<TaskNode[]> {
    const targetParentId = dto.parentId ?? null;

    if (targetParentId === id) {
      throw new CyclicMoveException();
    }

    await this.transaction(async (tx) => {
      const before = await this.tasks.findById(id, tx);
      if (!before) throw new TaskNotFoundException();

      // Both sibling groups have to be held before anything is read, or the
      // counts this move is about to act on can change underneath it. The first
      // read was unlocked, so re-read afterwards and pick up the group the task
      // actually sits in now if it moved in between.
      await this.tasks.lockGroups([before.parentId, targetParentId], tx);
      await this.tasks.lockBranchForMove(id, targetParentId, tx);

      const task = await this.tasks.findById(id, tx);
      if (!task) throw new TaskNotFoundException();

      if (task.parentId !== before.parentId) {
        await this.tasks.lockGroups([task.parentId], tx);
      }

      // One walk of the subtree answers both questions a move has to ask: does
      // the destination sit inside the branch being moved, and would the branch
      // still fit under the nesting limit once it lands there.
      const { height, containsCandidate } = await this.tasks.inspectSubtree(id, targetParentId, tx);

      if (containsCandidate) {
        throw new CyclicMoveException();
      }

      const depth = (await this.resolveParentDepth(targetParentId, tx)) + 1;
      if (depth + height > MAX_DEPTH) {
        throw new MaxDepthExceededException(depth + height);
      }

      const position = await this.resolveTargetPosition(task, targetParentId, dto.position, tx);

      // Ordering matters: pulling the task out of its old group first means the
      // gap we open in the new group is measured against a list that no longer
      // counts the task twice, which keeps same-parent reordering correct.
      await this.tasks.closeGap(task.parentId, task.position, tx);
      await this.tasks.openGap(targetParentId, position, id, tx);
      await this.tasks.place(id, targetParentId, position, depth, tx);
      await this.tasks.shiftDescendantDepth(id, depth - task.depth, tx);
    });

    return this.findTree();
  }

  /** Test helper. Clears the table between e2e cases. */
  async removeAll(): Promise<void> {
    await this.tasks.deleteAll();
  }

  /** Level of the destination parent, or 0 for the top level. */
  private async resolveParentDepth(parentId: string | null, tx: Db): Promise<number> {
    if (parentId === null) return 0;

    const parent = await this.tasks.findById(parentId, tx);
    if (!parent) throw new ParentNotFoundException();

    return parent.depth;
  }

  /**
   * Clamps the requested index against the destination group as it will look
   * once the task has been pulled out of it. Clamping rather than rejecting
   * keeps the endpoint forgiving about an index that a concurrent change has
   * just invalidated.
   */
  private async resolveTargetPosition(
    task: TaskRecord,
    targetParentId: string | null,
    requested: number,
    tx: Db,
  ): Promise<number> {
    const siblingCount = await this.tasks.countChildren(targetParentId, tx);
    const slots = targetParentId === task.parentId ? siblingCount - 1 : siblingCount;

    return Math.min(Math.max(requested, 0), Math.max(slots, 0));
  }

  /**
   * Runs a unit of work in a transaction, retrying the few times it takes to get
   * past a conflict.
   *
   * Every write is a read-modify-write over a sibling group and a move touches
   * two at once, so the writes take an advisory lock on the groups they need
   * (see `lockGroups`) and run at the default isolation level. SERIALIZABLE was
   * the first thing tried and it was the wrong tool: every top-level write reads
   * the same `parent_id IS NULL` predicate, so a handful of simultaneous
   * requests spend their attempts aborting each other. The lock orders them
   * instead of making them race. The retry stays as a backstop for a deadlock.
   */
  private async transaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, { maxWait: 10_000, timeout: 20_000 });
      } catch (error) {
        if (!isWriteConflict(error)) throw error;
        lastError = error;

        if (attempt < MAX_TRANSACTION_ATTEMPTS) {
          await sleep(Math.random() * RETRY_BACKOFF_MS * attempt);
        }
      }
    }

    throw lastError;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Prisma raises `P2034` when it recognises a conflict itself, but a conflict
 * that surfaces from a raw statement arrives as a generic `P2010` with the
 * PostgreSQL SQLSTATE buried in the driver adapter's error. Both mean the same
 * thing here: run the transaction again.
 */
function isWriteConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  if (error.code !== 'P2010') return false;

  const cause = (
    error.meta as { driverAdapterError?: { cause?: { originalCode?: unknown } } } | undefined
  )?.driverAdapterError?.cause;

  return typeof cause?.originalCode === 'string' && RETRYABLE_SQLSTATES.has(cause.originalCode);
}

function isMissingRecord(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}
