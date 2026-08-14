# Outline

Task list with nested subtasks — up to 5 levels deep, reorder and re-parent by
dragging, everything stored in PostgreSQL and read/written over a REST API.
Test assignment for BWA.

- Demo: https://outline-web-30n7.onrender.com
- API docs (Swagger): https://outline-api-6xpf.onrender.com/api/docs

| Layer    | Tech                                               |
| -------- | -------------------------------------------------- |
| Frontend | React 19, TypeScript, Vite, MobX 7, Axios, dnd-kit |
| Backend  | NestJS 11, Prisma 7, class-validator, Swagger      |
| Database | PostgreSQL 17                                      |
| Hosting  | Render (API + static site + managed Postgres)      |

## Features

- Add a task at the top level, or a subtask under anything that isn't already on
  level 5.
- Rename inline, delete a task with its whole subtree.
- Drag to reorder; drag sideways to change nesting. You grab a row anywhere on
  it, not by a handle.
- Collapse a branch. Collapsed or not, dragging moves the whole branch.
- Keyboard: focus a row, hold **Alt** (**⌥ Option** on macOS) with the arrows.

Writes hit the database right away. The UI applies the change locally first so
nothing waits on the network, and rolls back with an error toast if the request
fails.

## Prerequisites

- Node 22+
- Docker (for PostgreSQL)

## Running

```bash
git clone https://github.com/Orko333/bwa-task-list.git
cd bwa-task-list
npm install

cp apps/api/.env.example apps/api/.env

npm run db:up          # PostgreSQL 17 on port 5433
npm run db:migrate
npm run db:seed        # optional, sample tree

npm run dev            # API on :3000, web on :5173
```

The e2e suite needs a second database. Create it once:

```bash
docker compose exec postgres psql -U bwa -d postgres \
  -c "CREATE DATABASE bwa_tasks_test OWNER bwa;"
```

| Command             | What it does                             |
| ------------------- | ---------------------------------------- |
| `npm run dev`       | Both apps in watch mode                  |
| `npm run build`     | Production build of both                 |
| `npm test`          | Unit tests, both apps                    |
| `npm run test:e2e`  | API tests against a real PostgreSQL      |
| `npm run typecheck` | `tsc --noEmit` on both                   |
| `npm run lint`      | ESLint on the API, oxlint on the web app |
| `npm run db:reset`  | Drop, migrate, reseed                    |

## Data model

One `tasks` table, adjacency list. Two of the columns are derived and kept in
sync by the service instead of being computed on every read:

| Column      | Meaning                                       |
| ----------- | --------------------------------------------- |
| `parent_id` | `NULL` for a top-level task                   |
| `position`  | Index among siblings, always a dense `0..n-1` |
| `depth`     | `1` for a top-level task, `parent.depth + 1`  |

Keeping `depth` on the row makes the nesting check a single comparison instead
of a walk up the tree, and lets the database enforce the rule as well:

```sql
CHECK (depth BETWEEN 1 AND 5)
CHECK ((parent_id IS NULL) = (depth = 1))
CHECK (position >= 0)
CHECK (length(btrim(title)) > 0)
```

> **Note:** these constraints are a backstop, not the primary guard — the API
> checks the same things before it writes. They're there so a bug shows up as a
> failed write instead of a broken tree.

`GET /api/tasks` reads everything with one recursive CTE that builds a
`sort_path` out of each ancestor's position. Postgres returns the rows already
in depth-first order, so nesting them is a single pass.

## The move endpoint

`PATCH /api/tasks/:id/move` takes `{ parentId, position }`. In one transaction:

1. Take an advisory lock on both sibling groups (keyed on parent id, acquired in
   sorted order) and on the branch being moved.
2. Walk the subtree once. That one query answers both questions: is the
   destination inside the branch, and how tall is the branch.
3. Reject a move into the branch's own subtree — `400 CYCLIC_MOVE`.
4. Reject a move whose deepest leaf would end up past level 5 — `422
   MAX_DEPTH_EXCEEDED`. Worth spelling out: level 4 still takes children, so a
   single row can move there, but a branch 3 levels tall can't.
5. Close the gap in the old sibling group, open one in the new group, place the
   task, shift the depth of every descendant in one statement.

I started with `SERIALIZABLE` + retry instead of the locks. It doesn't work
here: every top-level write reads the same `parent_id IS NULL` predicate, so a
handful of concurrent requests just abort each other until the retries run out
and the last one 500s. There's an e2e case for it. The advisory lock orders the
writers instead; the retry is still there for deadlocks.

The response is the whole tree, not the moved task. A single move renumbers an
arbitrary number of rows in two groups and re-levels a branch, so it's less work
(and less to get wrong) than having the client replay the same bookkeeping.

### Endpoints

| Method   | Path                  | Notes                                       |
| -------- | --------------------- | ------------------------------------------- |
| `GET`    | `/api/tasks`          | The tree, in display order                  |
| `POST`   | `/api/tasks`          | Appends to the end of its sibling group     |
| `PATCH`  | `/api/tasks/:id`      | Rename                                      |
| `PATCH`  | `/api/tasks/:id/move` | Re-parent and reorder, returns the new tree |
| `DELETE` | `/api/tasks/:id`      | Cascades to the subtree                     |
| `GET`    | `/api/meta`           | Limits the API enforces                     |
| `GET`    | `/api/health`         | Touches the database                        |

Errors carry a `code` next to the message: `TASK_NOT_FOUND`,
`PARENT_NOT_FOUND`, `MAX_DEPTH_EXCEEDED`, `CYCLIC_MOVE`. The frontend uses it:
a 404 means the row is already gone server-side, so it re-reads the tree rather
than restoring its own snapshot on top. Messages are written for whoever is
reading them and don't contain ids.

`/api/meta` publishes the nesting limit and the max title length so they have a
single owner. The web app fetches them with the tree and uses whatever comes
back.

## Drag and drop

The list is kept flat, depth-first, with `depth` on every row. That's the shape
a sortable list wants anyway, so dragging never walks a tree.

Vertical movement is dnd-kit's. The horizontal half is a pure function,
[`project`](apps/web/src/domain/projection.ts), that turns pointer travel into a
level and clamps it:

- The row above sets the ceiling: at most one level below it.
- The row below sets the floor. Going shallower would silently adopt that row as
  a child.
- The nesting limit lowers the ceiling by the height of the dragged branch, so a
  tall branch is never offered a level it doesn't fit in.

If those bounds cross, the slot is refused rather than clamped — a branch too
tall for the gap has no level that both stays under the limit and leaves the row
below with its own parent.

Since it's a plain function over plain data, it's unit-tested instead of driven
through a browser, and Alt+Up/Down reuse it directly.

The dragged row is its own preview: it lifts, follows the pointer vertically and
re-indents live to the level it would land on. Its subtree is hidden while
dragging and a badge shows how many rows are moving with it.

The whole row is the drag handle, so the sensors have to know when a press isn't
a drag:

- **Mouse** — separated by distance (4px). Press and release without moving and
  the row's buttons behave normally.
- **Touch** — separated by time (220ms hold). A swipe still scrolls the list.
- Presses that land on a button or an input never start a drag at all.

A row moved with the keyboard gets highlighted for a moment after it lands,
since it usually ends up somewhere you weren't looking.

## Frontend state

One MobX store holds the flat array; visible rows are a computed value. The
array is annotated `observableRef` and every operation swaps in a new one, so
the previous array doubles as the rollback snapshot. Each write also bumps a
revision counter. A response that comes back against a list it wasn't computed
from gets dropped, and the tree is re-read instead.

Create is the one thing that can't be fully optimistic, since the id is the
primary key and has to come from the server. The row shows up immediately under
a temporary id and adopts the real one when the response arrives.

## Tests

```bash
npm test            # 6 API + 51 web unit tests
npm run test:e2e    # 38 API tests against a real database
```

The API suite runs against real PostgreSQL, not a mock. The parts worth testing
only exist in the database: recursive CTEs, check constraints, the transaction.
It covers the depth limit from both directions, cycles, position density after a
run of moves, cascade deletes, and concurrent writes.

On the web side the tests sit on the two pure modules and the store: projection
maths, branch moves, and that a failed request restores the tree and says why.

> **Note:** `npm test` on the API runs with
> `NODE_OPTIONS=--experimental-vm-modules`. Prisma 7 loads its query compiler
> through a dynamic import and Jest can't do that otherwise.

## Deploying

[`render.yaml`](render.yaml) declares all three services. Point a Render
blueprint at the repo and it creates the database, the API and the static site.

It'll ask for `CORS_ORIGIN` and `VITE_API_URL` (marked `sync: false`), because
each service needs the other's public URL. `fromService` looks like it should
handle this but doesn't: its `host` property is the private network hostname,
which no browser can resolve, and it doesn't accept a static site as the
referenced service.

Both build commands use `--include=dev`, because Render sets
`NODE_ENV=production` and `npm ci` would otherwise skip the compilers and the
Prisma CLI. Migrations run
from the start command, so a deploy never serves a build against an old schema.

Two things about the free tier: instances sleep after 15 minutes idle and take
about a minute to wake, so
[`.github/workflows/keep-awake.yml`](.github/workflows/keep-awake.yml) pings
`/api/health` every 10 minutes (set the `DEMO_API_URL` repo variable to enable
it). And a free database expires after 30 days.

## Project structure

```
bwa-task-list/
├── apps/
│   ├── api/
│   │   ├── prisma/            # schema, migrations, seed
│   │   └── src/
│   │       ├── tasks/         # controller, service, repository, DTOs
│   │       ├── prisma/        # PrismaService
│   │       ├── health/
│   │       └── meta/
│   └── web/
│       └── src/
│           ├── api/           # axios client, endpoints
│           ├── domain/        # flat-list + projection maths (pure, tested)
│           ├── stores/        # MobX
│           ├── features/tasks/
│           └── components/
├── render.yaml
└── docker-compose.yml
```

## Notes

- No virtualisation — every row renders. A hand-written outline stays in the
  hundreds, and `content-visibility` breaks the measurements dnd-kit takes on
  drag start. First thing I'd change past a few thousand rows.
- Keyboard reordering is Alt+arrows, not a keyboard drag. dnd-kit can do the
  latter, but on a tree it needs a custom coordinate getter and the two axes
  stay hard to separate. Up/Down walk the same slots a pointer would drop into;
  Left/Right are indent and outdent, which aren't the same thing as dragging
  sideways. Everything is announced through a live region.
- Positions are dense integers, renumbered on write. Fractional indexing would
  avoid that, but sibling groups are small here and a dense sequence is easier
  to reason about and to assert on. Would revisit if this became collaborative.
- `depth` is denormalised. Buys a cheap limit check and a DB-level constraint,
  costs a subtree update per move, which is one statement, so it's fine here.
- No optimistic locking. Two people on the same tree is outside the brief; the
  advisory locks keep the database consistent but won't stop a second client
  overwriting someone's rename.

## Possible next steps

Undo for deletes — the confirmation dialog covers the accident, but an undo
window would be nicer. Then completion state with counts rolling up a branch,
and a websocket so a second tab stays in sync.
