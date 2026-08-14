import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // `prisma generate` runs on install and needs no connection, so an absent
    // URL must not stop it. The commands that do need one say so themselves.
    url: process.env.DATABASE_URL ?? '',
  },
});
