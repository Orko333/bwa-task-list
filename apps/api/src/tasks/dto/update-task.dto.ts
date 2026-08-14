import { TaskTitle } from './task-title.decorator';

export class UpdateTaskDto {
  @TaskTitle()
  title!: string;
}
