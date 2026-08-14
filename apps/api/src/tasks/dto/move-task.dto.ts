import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class MoveTaskDto {
  @ApiPropertyOptional({
    description: 'New parent. Omit or send null to move the task to the top level.',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  @ApiProperty({
    description:
      'Zero-based index among the new siblings, counted with the moved task removed from the list. ' +
      'Values past the end are clamped.',
    minimum: 0,
    example: 0,
  })
  @IsInt()
  @Min(0)
  position!: number;
}
