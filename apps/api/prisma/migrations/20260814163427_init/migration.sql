-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "parent_id" UUID,
    "position" INTEGER NOT NULL,
    "depth" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_parent_id_position_idx" ON "tasks"("parent_id", "position");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Invariants that TasksService also enforces in application code. They are
-- duplicated here so a bug in the service can never leave the tree in an
-- unusable shape: the depth ceiling is a product requirement, and a row is a
-- root if and only if it sits on the first level.
ALTER TABLE "tasks"
    ADD CONSTRAINT "tasks_depth_within_limit" CHECK ("depth" BETWEEN 1 AND 5),
    ADD CONSTRAINT "tasks_root_is_first_level" CHECK (("parent_id" IS NULL) = ("depth" = 1)),
    ADD CONSTRAINT "tasks_position_not_negative" CHECK ("position" >= 0),
    ADD CONSTRAINT "tasks_title_not_blank" CHECK (length(btrim("title")) > 0);
