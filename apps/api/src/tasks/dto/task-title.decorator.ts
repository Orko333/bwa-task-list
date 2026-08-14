import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

import { MAX_TITLE_LENGTH } from '../tasks.constants';

/**
 * PostgreSQL refuses a NUL byte in a text column, and without this the driver
 * error comes back as a 500 rather than a 400. The rest of the control range is
 * rejected on the same grounds: nothing in a task name needs it.
 */
const WITHOUT_CONTROL_CHARACTERS = /^[^\p{Cc}]*$/u;

/** Shared by the create and rename bodies, which accept the same title. */
export function TaskTitle(): PropertyDecorator {
  return applyDecorators(
    ApiProperty({ example: 'Prepare the release notes', maxLength: MAX_TITLE_LENGTH }),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? value.trim() : value,
    ),
    IsString(),
    Length(1, MAX_TITLE_LENGTH),
    Matches(WITHOUT_CONTROL_CHARACTERS, {
      message: 'title must not contain control characters',
    }),
  );
}
