import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client.js';

/**
 * Sample tree used for local development and for the deployed demo. It reaches
 * the deepest allowed level on purpose, so the "add subtask" button is disabled
 * somewhere visible as soon as the app opens.
 */
const TREE: Branch[] = [
  {
    title: 'Launch the mobile app',
    children: [
      {
        title: 'Ship the onboarding flow',
        children: [
          {
            title: 'Design review',
            children: [{ title: 'Collect feedback', children: [{ title: 'Sign off' }] }],
          },
          { title: 'Wire up analytics events' },
        ],
      },
      { title: 'Prepare the store listing', children: [{ title: 'Screenshots' }, { title: 'Copy' }] },
    ],
  },
  {
    title: 'Migrate billing to the new provider',
    children: [{ title: 'Map the existing plans' }, { title: 'Dry run with test accounts' }],
  },
  { title: 'Write the quarterly report' },
];

interface Branch {
  title: string;
  children?: Branch[];
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function insert(branches: Branch[], parentId: string | null, depth: number): Promise<void> {
  for (const [position, branch] of branches.entries()) {
    const task = await prisma.task.create({
      data: { title: branch.title, parentId, position, depth },
    });

    if (branch.children?.length) {
      await insert(branch.children, task.id, depth + 1);
    }
  }
}

async function main(): Promise<void> {
  await prisma.$executeRaw`TRUNCATE TABLE tasks RESTART IDENTITY CASCADE`;
  await insert(TREE, null, 1);

  const total = await prisma.task.count();
  console.log(`Seeded ${total} tasks`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
