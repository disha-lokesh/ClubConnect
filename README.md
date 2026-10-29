# ClubConnect: Club Event Management & Registration System

DBMS Experiential Learning, Level 3 mini project (PES University). Next.js + TypeScript front end and API, **PostgreSQL** (relational core, RBAC, triggers, functions) and **MongoDB** (announcements, feedback, activity log).

Three account roles: **Student**, **Club admin**, **Campus admin**. Core workflow: club drafts and submits an event -> campus admin approves (venue clashes blocked by the database) -> students find it in the catalogue/calendar and register (instantly confirmed, or pending until the club approves) -> club manages participants and attendance -> notifications, history and reports.

Documentation index: `docs/01-requirements-tracker.md`, `02-er-and-relational-schema.md`, `03-mongodb-model.md`, `04-architecture-and-security.md`, `05-testing.md`, `06-deviations-and-decisions.md`, `07-viva-guide.md`, `08-contributions.md`. Demo SQL scripts: `db/demo/`, their real output: `docs/outputs/`.

## 1. Prerequisites

* Node.js 20.12 or newer (built with 22) and npm
* PostgreSQL **15 or newer** (built with 16; `security_invoker` views need 15+) and a superuser able to create roles/extensions (`btree_gist`)
* MongoDB 6, 7 or 8 running locally (default `mongodb://localhost:27017`)

## 2. Configure

```bash
npm install
createdb -U postgres clubconnect          # or: psql -U postgres -c "CREATE DATABASE clubconnect"
cp .env.example .env                      # then edit .env
```

In `.env` set `DATABASE_URL_ADMIN` (owner/superuser, used only by migrations and seeds), `DB_APP_PASSWORD` and the matching `DATABASE_URL` for the restricted `clubconnect_app` login role, `MONGODB_URI`, and `SESSION_SECRET` (at least 32 random characters, e.g. `openssl rand -base64 48`). Never commit `.env`.

## 3. Create and seed the databases

```bash
npm run db:setup      # = migrate + seed PostgreSQL + create Mongo collections + seed Mongo
```

or step by step: `npm run db:migrate`, `npm run db:seed`, `npm run mongo:init`, `npm run mongo:seed`. Re-seed from scratch with `node scripts/seed.mjs --reset`.

Seeded demo accounts (**development only**): `admin@pes.edu` (campus admin), `acmw@pes.edu` / `acmw123`, `mcop@pes.edu` / `mcop123`, `pixels@pes.edu` / `pixels123` (club admins), `aarav.sharma1@stu.pes.edu` (student).

## 4. Run

```bash
npm run dev                         # development, http://localhost:3000
# or production build:
npm run build && npm start
```

`next start` marks the session cookie `Secure`; Chrome/Edge/Firefox accept that on `localhost`, Safari may not. Use `npm run dev` there.

## 5. Run the tests

```bash
npm run test:db       # database suite (needs seeded PostgreSQL)
npm run test:mongo    # MongoDB suite
node scripts/seed.mjs --reset && npm run test:api   # end-to-end, app must be running (BASE_URL=http://localhost:3000 if not 3100)
```

Results are written to `docs/test-results-*.md`. Read `docs/05-testing.md` for what is and is not verified. With real MongoDB, **do not** set `MONGO_COMPAT_MODE`; that flag exists only for MongoDB-compatible test servers.

## 6. SQL demonstrations

```bash
psql -U postgres -d clubconnect -f db/demo/01_ddl.sql     # DDL, ALTER, DROP, constraint violations
psql -U postgres -d clubconnect -f db/demo/02_dml.sql     # INSERT/UPDATE/DELETE/UPSERT (rolled back)
psql -U postgres -d clubconnect -f db/demo/03_queries.sql # joins, nested, correlated, recursive CTE, windows
psql -U postgres -d clubconnect -f db/demo/04_advanced.sql# functions, triggers, locking, exclusion constraint, EXPLAIN
psql -U postgres -d clubconnect -f db/demo/05_rbac.sql    # roles, GRANTs, row-level security
```

## 7. Project layout

```
db/migrations/   001 schema, 002 functions+triggers, 003 views+indexes, 004 roles+RLS, 005 session check, 006 policy tightening
db/demo/         SQL demonstration scripts
scripts/         migrate, seed, mongo init/seed, test suites
src/app/         pages (student/, club/, campus/, login, register) and REST API (api/)
src/lib/         db access (role switching), sessions, validation, Mongo layer, reports
src/components/  shared UI
docs/            documentation, test results, captured SQL output
```

## 8. Git and GitHub (your step)

No commit history is included on purpose: commits should record your own work.

```bash
git init && git add . && git commit -m "Initial project import"
git branch -M main && git remote add origin <your repo url> && git push -u origin main
```

`.gitignore` already excludes `.env`, `node_modules/` and `.next/`. Check `git status` shows no `.env` before pushing. Commit further changes in small steps with meaningful messages as you learn and modify the code.

## 9. Before you submit

* Production: remove the demo seed, use strong unique passwords, configure PostgreSQL `scram-sha-256` and TLS, set a real `SESSION_SECRET`.
* Fill in `docs/08-contributions.md` truthfully and read `docs/07-viva-guide.md`.
# ClubConnect
