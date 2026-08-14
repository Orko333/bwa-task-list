import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';

import { MAX_DEPTH, MAX_TITLE_LENGTH } from '../tasks/tasks.constants';

export class MetaEntity {
  @ApiProperty({ description: 'Deepest level a task may occupy', example: MAX_DEPTH })
  maxDepth!: number;

  @ApiProperty({ description: 'Longest accepted task title', example: MAX_TITLE_LENGTH })
  maxTitleLength!: number;
}

/**
 * Limits the UI needs in order to disable "add subtask" at the deepest level and
 * to cap the rename field. Serving them keeps the numbers in one place instead of
 * duplicating them in the web app, where they would quietly drift.
 */
@ApiTags('meta')
@Controller('meta')
export class MetaController {
  @Get()
  @ApiOperation({ summary: 'Read the limits the API enforces' })
  @ApiOkResponse({ type: MetaEntity })
  read(): MetaEntity {
    return { maxDepth: MAX_DEPTH, maxTitleLength: MAX_TITLE_LENGTH };
  }
}
