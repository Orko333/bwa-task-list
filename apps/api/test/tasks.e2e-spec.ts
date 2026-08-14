import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { TasksService } from '../src/tasks/tasks.service';

interface TaskResponse {
  id: string;
  title: string;
  parentId: string | null;
  position: number;
  depth: number;
}

interface TaskNodeResponse extends TaskResponse {
  children: TaskNodeResponse[];
}

describe('Tasks API (e2e)', () => {
  let app: INestApplication<App>;
  let server: App;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );

    // Listening once, rather than letting supertest open an ephemeral port per
    // request: under the concurrent cases below, a request could otherwise land
    // on a listener that was already tearing down and come back as a 404.
    await app.listen(0);
    server = app.getHttpServer();
  });

  beforeEach(async () => {
    await app.get(TasksService).removeAll();
  });

  afterAll(async () => {
    await app.close();
  });

  // helpers

  /** supertest types `.body` as `any`; this keeps the cast in one place. */
  function json<T = unknown>(response: request.Response): T {
    return response.body as T;
  }

  async function createTask(title: string, parentId?: string): Promise<TaskResponse> {
    const response = await request(server)
      .post('/api/tasks')
      .send(parentId ? { title, parentId } : { title })
      .expect(201);

    return json<TaskResponse>(response);
  }

  async function readTree(): Promise<TaskNodeResponse[]> {
    const response = await request(server).get('/api/tasks').expect(200);
    return json<TaskNodeResponse[]>(response);
  }

  /** Renders the tree as indented lines so assertions read like the UI looks. */
  function outline(nodes: TaskNodeResponse[], indent = ''): string[] {
    return nodes.flatMap((node) => [
      `${indent}${node.title} (${node.depth})`,
      ...outline(node.children, `${indent}  `),
    ]);
  }

  /** Rows whose level is not one below their parent's. Should always be empty. */
  function brokenLevels(nodes: TaskNodeResponse[], parentDepth = 0): string[] {
    return nodes.flatMap((node) => [
      ...(node.depth === parentDepth + 1 ? [] : [`${node.title} (${node.depth})`]),
      ...brokenLevels(node.children, node.depth),
    ]);
  }

  function deepestLevel(nodes: TaskNodeResponse[]): number {
    return nodes.reduce(
      (deepest, node) => Math.max(deepest, node.depth, deepestLevel(node.children)),
      0,
    );
  }

  /** Builds a chain that reaches the deepest allowed level and returns every id. */
  async function createFullDepthChain(): Promise<TaskResponse[]> {
    const chain: TaskResponse[] = [await createTask('level 1')];

    for (let level = 2; level <= 5; level += 1) {
      chain.push(await createTask(`level ${level}`, chain[chain.length - 1]!.id));
    }

    return chain;
  }

  // reading

  describe('GET /api/tasks', () => {
    it('returns an empty list when nothing exists', async () => {
      await expect(readTree()).resolves.toEqual([]);
    });

    it('returns the tree in the order it is displayed', async () => {
      const first = await createTask('first');
      await createTask('second');
      const child = await createTask('child', first.id);
      await createTask('grandchild', child.id);
      await createTask('sibling of child', first.id);

      expect(outline(await readTree())).toEqual([
        'first (1)',
        '  child (2)',
        '    grandchild (3)',
        '  sibling of child (2)',
        'second (1)',
      ]);
    });
  });

  describe('GET /api/meta', () => {
    it('publishes the limits the API enforces', async () => {
      const response = await request(server).get('/api/meta').expect(200);

      expect(json(response)).toEqual({ maxDepth: 5, maxTitleLength: 200 });
    });
  });

  describe('GET /api/health', () => {
    it('reports the database as reachable', async () => {
      await request(server).get('/api/health').expect(200, { status: 'ok', database: 'ok' });
    });
  });

  // creating

  describe('POST /api/tasks', () => {
    it('appends top-level tasks in creation order', async () => {
      const first = await createTask('first');
      const second = await createTask('second');

      expect(first).toMatchObject({ parentId: null, position: 0, depth: 1 });
      expect(second).toMatchObject({ parentId: null, position: 1, depth: 1 });
    });

    it('places a subtask one level below its parent', async () => {
      const parent = await createTask('parent');
      const child = await createTask('child', parent.id);

      expect(child).toMatchObject({ parentId: parent.id, position: 0, depth: 2 });
    });

    it('trims whitespace off the title', async () => {
      const task = await createTask('  padded  ');

      expect(task.title).toBe('padded');
    });

    it('rejects a sixth level', async () => {
      const chain = await createFullDepthChain();

      const response = await request(server)
        .post('/api/tasks')
        .send({ title: 'level 6', parentId: chain[4]!.id })
        .expect(422);

      expect(json(response)).toMatchObject({ code: 'MAX_DEPTH_EXCEEDED' });
    });

    it('rejects an unknown parent', async () => {
      const response = await request(server)
        .post('/api/tasks')
        .send({ title: 'orphan', parentId: '00000000-0000-4000-8000-000000000000' })
        .expect(404);

      expect(json(response)).toMatchObject({ code: 'PARENT_NOT_FOUND' });
    });

    it('handles a burst of simultaneous creates without dropping any', async () => {
      const responses = await Promise.all(
        ['one', 'two', 'three', 'four', 'five'].map((title) =>
          request(server).post('/api/tasks').send({ title }),
        ),
      );

      expect(responses.every((response) => response.status === 201)).toBe(true);

      const tree = await readTree();
      expect(tree).toHaveLength(5);
      expect(tree.map((node) => node.position)).toEqual([0, 1, 2, 3, 4]);
    });

    it.each([
      ['a blank title', { title: '   ' }],
      ['a missing title', {}],
      ['an over-long title', { title: 'x'.repeat(201) }],
      ['a malformed parent id', { title: 'ok', parentId: 'not-a-uuid' }],
      ['an unexpected field', { title: 'ok', depth: 4 }],
      // PostgreSQL cannot store a NUL byte in a text column; without the guard
      // the driver error surfaces as a 500.
      ['a NUL byte in the title', { title: 'before\u0000after' }],
      ['a newline in the title', { title: 'two\nlines' }],
    ])('rejects %s', async (_case, payload) => {
      await request(server).post('/api/tasks').send(payload).expect(400);
    });
  });

  // renaming

  describe('PATCH /api/tasks/:id', () => {
    it('renames a task', async () => {
      const task = await createTask('before');

      const response = await request(server)
        .patch(`/api/tasks/${task.id}`)
        .send({ title: 'after' })
        .expect(200);

      expect(json(response)).toMatchObject({ id: task.id, title: 'after' });
    });

    it('404s on an unknown task', async () => {
      const response = await request(server)
        .patch('/api/tasks/00000000-0000-4000-8000-000000000000')
        .send({ title: 'after' })
        .expect(404);

      expect(json(response)).toMatchObject({ code: 'TASK_NOT_FOUND' });
    });

    it('400s on a malformed id', async () => {
      await request(server).patch('/api/tasks/nope').send({ title: 'after' }).expect(400);
    });
  });

  // deleting

  describe('DELETE /api/tasks/:id', () => {
    it('removes the whole subtree', async () => {
      const parent = await createTask('parent');
      const child = await createTask('child', parent.id);
      await createTask('grandchild', child.id);

      await request(server).delete(`/api/tasks/${parent.id}`).expect(204);

      await expect(readTree()).resolves.toEqual([]);
    });

    it('closes the gap left behind in the sibling group', async () => {
      await createTask('first');
      const second = await createTask('second');
      await createTask('third');

      await request(server).delete(`/api/tasks/${second.id}`).expect(204);

      const tree = await readTree();
      expect(tree.map((node) => [node.title, node.position])).toEqual([
        ['first', 0],
        ['third', 1],
      ]);
    });

    it('404s on an unknown task', async () => {
      await request(server).delete('/api/tasks/00000000-0000-4000-8000-000000000000').expect(404);
    });
  });

  // moving

  describe('PATCH /api/tasks/:id/move', () => {
    async function move(
      id: string,
      body: { parentId?: string | null; position: number },
    ): Promise<TaskNodeResponse[]> {
      const response = await request(server).patch(`/api/tasks/${id}/move`).send(body).expect(200);
      return response.body as TaskNodeResponse[];
    }

    it('reorders within the same parent', async () => {
      await createTask('a');
      await createTask('b');
      const c = await createTask('c');

      const tree = await move(c.id, { parentId: null, position: 0 });

      expect(tree.map((node) => [node.title, node.position])).toEqual([
        ['c', 0],
        ['a', 1],
        ['b', 2],
      ]);
    });

    it('moves a task to the end of its own group', async () => {
      const a = await createTask('a');
      await createTask('b');
      await createTask('c');

      const tree = await move(a.id, { parentId: null, position: 2 });

      expect(tree.map((node) => node.title)).toEqual(['b', 'c', 'a']);
    });

    it('clamps a position past the end of the group', async () => {
      const a = await createTask('a');
      await createTask('b');

      const tree = await move(a.id, { parentId: null, position: 99 });

      expect(tree.map((node) => [node.title, node.position])).toEqual([
        ['b', 0],
        ['a', 1],
      ]);
    });

    it('re-parents a task and closes the gap it leaves', async () => {
      const target = await createTask('target');
      const first = await createTask('first');
      const second = await createTask('second');

      const tree = await move(first.id, { parentId: target.id, position: 0 });

      expect(outline(tree)).toEqual(['target (1)', '  first (2)', 'second (1)']);
      expect(tree[1]!.position).toBe(1);
      expect(tree[0]!.children[0]).toMatchObject({ parentId: target.id, position: 0, depth: 2 });
      expect(second.id).toBe(tree[1]!.id);
    });

    it('promotes a subtask back to the top level', async () => {
      const parent = await createTask('parent');
      const child = await createTask('child', parent.id);
      await createTask('grandchild', child.id);

      const tree = await move(child.id, { parentId: null, position: 0 });

      expect(outline(tree)).toEqual(['child (1)', '  grandchild (2)', 'parent (1)']);
    });

    it('rewrites the depth of every descendant', async () => {
      const host = await createTask('host');
      const branchRoot = await createTask('branch root');
      const middle = await createTask('middle', branchRoot.id);
      await createTask('leaf', middle.id);

      const tree = await move(branchRoot.id, { parentId: host.id, position: 0 });

      expect(outline(tree)).toEqual([
        'host (1)',
        '  branch root (2)',
        '    middle (3)',
        '      leaf (4)',
      ]);
    });

    it('refuses to move a task into itself', async () => {
      const task = await createTask('task');

      const response = await request(server)
        .patch(`/api/tasks/${task.id}/move`)
        .send({ parentId: task.id, position: 0 })
        .expect(400);

      expect(json(response)).toMatchObject({ code: 'CYCLIC_MOVE' });
    });

    it('refuses to move a task into its own subtask', async () => {
      const parent = await createTask('parent');
      const child = await createTask('child', parent.id);

      const response = await request(server)
        .patch(`/api/tasks/${parent.id}/move`)
        .send({ parentId: child.id, position: 0 })
        .expect(400);

      expect(json(response)).toMatchObject({ code: 'CYCLIC_MOVE' });
    });

    // The destination itself still accepts children; it is the height of the
    // branch being dropped that pushes the deepest leaf past the limit.
    it('refuses a branch that would not fit under the destination', async () => {
      const chain = await createFullDepthChain();
      const tallBranch = await createTask('tall branch');
      const middle = await createTask('middle', tallBranch.id);
      await createTask('leaf', middle.id);

      const response = await request(server)
        .patch(`/api/tasks/${tallBranch.id}/move`)
        .send({ parentId: chain[2]!.id, position: 0 })
        .expect(422);

      expect(json(response)).toMatchObject({ code: 'MAX_DEPTH_EXCEEDED' });
    });

    it('accepts a branch that fits exactly', async () => {
      const chain = await createFullDepthChain();
      const branch = await createTask('branch');
      await createTask('leaf', branch.id);

      // Two levels of branch landing on level 3 fills the tree to level 5 and no
      // further, which is the boundary the check has to let through.
      const tree = await move(branch.id, { parentId: chain[2]!.id, position: 0 });

      expect(outline(tree)).toEqual([
        'level 1 (1)',
        '  level 2 (2)',
        '    level 3 (3)',
        '      branch (4)',
        '        leaf (5)',
        '      level 4 (4)',
        '        level 5 (5)',
      ]);
    });

    it('reports an unknown destination parent', async () => {
      const task = await createTask('task');

      const response = await request(server)
        .patch(`/api/tasks/${task.id}/move`)
        .send({ parentId: '00000000-0000-4000-8000-000000000000', position: 0 })
        .expect(404);

      expect(json(response)).toMatchObject({ code: 'PARENT_NOT_FOUND' });
    });

    it('rejects a negative position', async () => {
      const task = await createTask('task');

      await request(server)
        .patch(`/api/tasks/${task.id}/move`)
        .send({ parentId: null, position: -1 })
        .expect(400);
    });

    // Moves are read-modify-write over two sibling groups, so simultaneous ones
    // collide at SERIALIZABLE. They have to be retried, not returned as 500s.
    it('survives simultaneous moves of different rows', async () => {
      const roots: TaskResponse[] = [];
      for (const title of ['a', 'b', 'c', 'd']) {
        roots.push(await createTask(title));
      }

      const responses = await Promise.all(
        roots.map((task, index) =>
          request(server)
            .patch(`/api/tasks/${task.id}/move`)
            .send({ parentId: null, position: roots.length - 1 - index }),
        ),
      );

      expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200]);

      const tree = await readTree();
      expect(tree.map((node) => node.position)).toEqual([0, 1, 2, 3]);
      expect(new Set(tree.map((node) => node.title)).size).toBe(4);
    });

    /**
     * The invariant the per-row CHECK cannot see: every task sits exactly one
     * level below its parent. A move measures the branch and then re-levels it,
     * so anything appended inside the branch while that is in flight has to be
     * accounted for. Without the branch lock this interleaving either committed
     * a six-level tree or failed the check constraint with a 500.
     */
    it('keeps the tree consistent when a task is added inside a branch being moved', async () => {
      const host = await createTask('host');
      const chain = [await createTask('a')];
      for (const title of ['b', 'c', 'd']) {
        chain.push(await createTask(title, chain[chain.length - 1]!.id));
      }
      const deepest = chain[chain.length - 1]!;

      for (let round = 0; round < 6; round += 1) {
        const move = request(server)
          .patch(`/api/tasks/${chain[0]!.id}/move`)
          .send({ parentId: round % 2 === 0 ? host.id : null, position: 0 });

        const add = request(server)
          .post('/api/tasks')
          .send({ title: `leaf ${round}`, parentId: deepest.id });

        const [moveResult, addResult] = await Promise.all([move, add]);

        expect([200, 422]).toContain(moveResult.status);
        expect([201, 422]).toContain(addResult.status);

        const tree = await readTree();
        expect(brokenLevels(tree)).toEqual([]);
        expect(deepestLevel(tree)).toBeLessThanOrEqual(5);
      }
    });

    it('leaves positions dense after a run of moves', async () => {
      const roots = [await createTask('a'), await createTask('b'), await createTask('c')];
      await createTask('d');

      await move(roots[2]!.id, { parentId: null, position: 0 });
      await move(roots[0]!.id, { parentId: null, position: 3 });
      await move(roots[1]!.id, { parentId: roots[2]!.id, position: 0 });

      const tree = await readTree();
      const positions = (nodes: TaskNodeResponse[]): number[] =>
        nodes.flatMap((node) => [node.position, ...positions(node.children)]);

      expect(tree.map((node) => node.position)).toEqual([0, 1, 2]);
      expect(positions(tree).every((position) => position >= 0)).toBe(true);
      expect(tree[0]!.children.map((node) => node.position)).toEqual([0]);
    });
  });
});
