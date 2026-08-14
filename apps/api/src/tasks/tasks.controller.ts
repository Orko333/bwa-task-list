import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';

import { CreateTaskDto } from './dto/create-task.dto';
import { MoveTaskDto } from './dto/move-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { TaskEntity, TaskNodeEntity } from './entities/task.entity';
import { TaskNode, TaskRecord } from './task-tree';
import { TasksService } from './tasks.service';

@ApiTags('tasks')
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @ApiOperation({ summary: 'Read the whole task tree, ordered as it is displayed' })
  @ApiOkResponse({ type: [TaskNodeEntity] })
  findAll(): Promise<TaskNode[]> {
    return this.tasks.findTree();
  }

  @Post()
  @ApiOperation({ summary: 'Append a task to the end of its sibling group' })
  @ApiCreatedResponse({ type: TaskEntity })
  @ApiNotFoundResponse({ description: 'The requested parent does not exist' })
  @ApiUnprocessableEntityResponse({ description: 'The parent already sits on the deepest level' })
  create(@Body() dto: CreateTaskDto): Promise<TaskRecord> {
    return this.tasks.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a task' })
  @ApiOkResponse({ type: TaskEntity })
  @ApiNotFoundResponse({ description: 'No task with this id' })
  rename(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTaskDto): Promise<TaskRecord> {
    return this.tasks.rename(id, dto);
  }

  @Patch(':id/move')
  @ApiOperation({
    summary: 'Re-parent a task and/or change its order among siblings',
    description:
      'Returns the resulting tree: one move renumbers siblings in two groups and rewrites the ' +
      'depth of a whole branch, so the response carries the new state rather than leaving the ' +
      'client to reproduce it.',
  })
  @ApiOkResponse({ type: [TaskNodeEntity] })
  @ApiBadRequestResponse({ description: 'The task would become its own ancestor' })
  @ApiNotFoundResponse({ description: 'No task, or no such parent' })
  @ApiUnprocessableEntityResponse({
    description: 'The branch would not fit under the nesting limit',
  })
  move(@Param('id', ParseUUIDPipe) id: string, @Body() dto: MoveTaskDto): Promise<TaskNode[]> {
    return this.tasks.move(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a task together with its subtasks' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ description: 'No task with this id' })
  remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.tasks.remove(id);
  }
}
