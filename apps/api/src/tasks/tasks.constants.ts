/**
 * Deepest level a task may occupy. Roots sit on level 1, so a task on level 5
 * can be renamed and moved but can no longer take children.
 *
 * Changing this value alone is not enough: the `tasks_depth_within_limit` check
 * constraint in the initial migration hard-codes the same ceiling and needs a
 * follow-up migration.
 */
export const MAX_DEPTH = 5;

/** Longest accepted task title, mirrored by `title VARCHAR(200)` in the schema. */
export const MAX_TITLE_LENGTH = 200;
