import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '..', '.env'), quiet: true });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Copy apps/api/.env.example to apps/api/.env. The e2e suite ' +
      'truncates the database it points at, so it must not be the development one.',
  );
}

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
