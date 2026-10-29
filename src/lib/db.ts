import { Pool, types, type PoolClient } from 'pg';

// bigint (int8) columns come back as strings by default; our ids and counts are far below 2^53
types.setTypeParser(20, v => Number(v));

export type Role = 'STUDENT' | 'CLUB_ADMIN' | 'CAMPUS_ADMIN';
export type Session = { userId: number; role: Role; name: string };

// Fixed map -> the string interpolated into SET ROLE can never come from user input.
const DB_ROLE: Record<Role, string> = { STUDENT: 'app_student', CLUB_ADMIN: 'app_club_admin', CAMPUS_ADMIN: 'app_campus_admin' };

const g = globalThis as unknown as { _pgPool?: Pool };
export const pool: Pool = g._pgPool ?? (g._pgPool = new Pool({
  connectionString: process.env.DATABASE_URL,        // the restricted login role clubconnect_app
  max: 10, connectionTimeoutMillis: 4000, idleTimeoutMillis: 30000,
}));
pool.on('error', e => console.error('[pg pool]', e.message));

/**
 * Runs fn in ONE transaction acting as the user's database role:
 *   SET LOCAL ROLE app_<role>   -> table/column GRANTs and row-level security of that role now apply
 *   app.user_id = <id>          -> read by RLS policies, SECURITY DEFINER functions and audit triggers
 * Both settings are transaction-local, so a pooled connection never leaks one user's identity to the next request.
 */
export async function withUser<T>(s: Session, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${DB_ROLE[s.role]}`);
    await c.query(`SELECT set_config('app.user_id', $1, true)`, [String(s.userId)]);
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally { c.release(); }
}

/** Pre-login calls (authenticate_lookup, register_student, session_check): login role only, no SET ROLE. */
export async function asLogin<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { return await fn(c); } finally { c.release(); }
}
