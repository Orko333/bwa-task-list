import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * Brings the dedicated test database up to the current migration state once per
 * run. Every case truncates the tables it touches, so the schema is the only
 * thing that has to exist up front.
 */
export default function globalSetup(): void {
  const apiRoot = resolve(__dirname, '..');
  config({ path: resolve(apiRoot, '.env'), quiet: true });

  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('TEST_DATABASE_URL is not set. See apps/api/.env.example');
  }

  execSync('npx prisma migrate deploy', {
    cwd: apiRoot,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
