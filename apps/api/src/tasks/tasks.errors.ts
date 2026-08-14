import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common';

import { MAX_DEPTH } from './tasks.constants';

/**
 * Machine-readable discriminator carried alongside every domain error. The web
 * client switches on it instead of matching on message text.
 */
export type TaskErrorCode =
  'TASK_NOT_FOUND' | 'PARENT_NOT_FOUND' | 'MAX_DEPTH_EXCEEDED' | 'CYCLIC_MOVE';

function body(status: HttpStatus, code: TaskErrorCode, message: string) {
  return { statusCode: status, code, message };
}

/**
 * The messages are written for the person looking at the screen, so they carry
 * no ids. The id is already in the request that failed, and a client that wants
 * to branch on the failure has the `code`.
 */
export class TaskNotFoundException extends NotFoundException {
  constructor() {
    super(body(HttpStatus.NOT_FOUND, 'TASK_NOT_FOUND', 'This task no longer exists.'));
  }
}

export class ParentNotFoundException extends NotFoundException {
  constructor() {
    super(body(HttpStatus.NOT_FOUND, 'PARENT_NOT_FOUND', 'The parent task no longer exists.'));
  }
}

/**
 * Raised when a write would push a task, or part of the branch hanging off it,
 * past {@link MAX_DEPTH}.
 *
 * For a move it is the height of the branch that matters, not only the target
 * level: dropping a three-level branch onto level 4 is rejected even though
 * level 4 itself still accepts children.
 */
export class MaxDepthExceededException extends HttpException {
  constructor(requestedDepth: number) {
    super(
      body(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'MAX_DEPTH_EXCEEDED',
        `This would place a task on level ${requestedDepth}; only ${MAX_DEPTH} levels are allowed`,
      ),
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

/** Raised when a task would become its own ancestor. */
export class CyclicMoveException extends BadRequestException {
  constructor() {
    super(
      body(
        HttpStatus.BAD_REQUEST,
        'CYCLIC_MOVE',
        'A task cannot be moved into itself or into one of its own subtasks',
      ),
    );
  }
}
