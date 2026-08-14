import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

import { TaskTitle } from './task-title.decorator';

export class CreateTaskDto {
  @TaskTitle()
  title!: string;

  @ApiPropertyOptional({
    description: 'Parent task. Omit or send null to create a top-level task.',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;
}
