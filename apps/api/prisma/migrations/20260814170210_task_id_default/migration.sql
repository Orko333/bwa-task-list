-- Tasks are appended with a single INSERT ... SELECT that computes the position
-- in SQL, so the id has to come from the database rather than from the client.
-- Giving the column a default keeps that path and Prisma's own create in step.
ALTER TABLE "tasks" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
