import { ApiProperty } from '@nestjs/swagger';

import { MAX_DEPTH, MAX_TITLE_LENGTH } from '../tasks.constants';

/** Swagger view of a single task. Mirrors {@link TaskRecord}. */
export class TaskEntity {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ maxLength: MAX_TITLE_LENGTH })
  title!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  parentId!: string | null;

  @ApiProperty({ description: 'Zero-based index among siblings', minimum: 0 })
  position!: number;

  @ApiProperty({
    description: 'Nesting level, 1 for top-level tasks',
    minimum: 1,
    maximum: MAX_DEPTH,
  })
  depth!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

/** Swagger view of a task with its subtasks nested underneath. */
export class TaskNodeEntity extends TaskEntity {
  @ApiProperty({ type: () => [TaskNodeEntity] })
  children!: TaskNodeEntity[];
}
