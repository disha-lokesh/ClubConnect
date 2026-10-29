// Applies db/migrations/*.sql in order, once each, as the schema OWNER (DATABASE_URL_ADMIN).
// Then (re)sets the password of the restricted login role used by the web app (DB_APP_PASSWORD).
import { readdirSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { loadEnv } from './env.mjs';

const env = loadEnv();
const admin = env.DATABASE_URL_ADMIN;
if (!admin) { console.error('DATABASE_URL_ADMIN is not set (see .env.example)'); process.exit(1); }
if (!env.DB_APP_PASSWORD) { console.error('DB_APP_PASSWORD is not set (see .env.example)'); process.exit(1); }

const client = new pg.Client({ connectionString: admin });
await client.connect();
await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map(r => r.version));

for (const file of readdirSync('db/migrations').filter(f => f.endsWith('.sql')).sort()) {
  if (done.has(file)) { console.log(`skip   ${file}`); continue; }
  const sql = readFileSync(`db/migrations/${file}`, 'utf8');
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations(version) VALUES ($1)', [file]);
    await client.query('COMMIT');
    console.log(`apply  ${file}`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(`FAILED ${file}: ${e.message}`);
    process.exit(1);
  }
}
// The password is quoted server-side with format(%L), so it is never concatenated into SQL here.
const { rows } = await client.query(`SELECT format('ALTER ROLE clubconnect_app PASSWORD %L', $1::text) AS stmt`, [env.DB_APP_PASSWORD]);
await client.query(rows[0].stmt);
console.log('login role clubconnect_app is ready');
await client.end();
