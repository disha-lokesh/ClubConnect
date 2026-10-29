import { NextRequest, NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { getSession } from './session';
import type { Role, Session } from './db';
import { MongoUnavailableError } from './mongo';

export class ApiError extends Error {
  constructor(public status: number, message: string, public extra?: Record<string, unknown>) { super(message); }
}

const DB_DOWN_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', '57P01', '57P02', '57P03', '08000', '08001', '08003', '08006']);

/** Turns any thrown error into a safe ApiError. Internal details are logged, never sent to the browser. */
export function mapError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof ZodError) return new ApiError(422, e.issues.map(i => `${i.path.join('.') || 'value'}: ${i.message}`).join('; '));
  if (e instanceof MongoUnavailableError) return new ApiError(503, 'The activity/announcement service (MongoDB) is temporarily unavailable.');
  const err = e as { code?: string; message?: string; constraint?: string };
  const code = err?.code ?? '';
  if (DB_DOWN_CODES.has(code) || /timeout exceeded when trying to connect|Connection terminated|connect ECONNREFUSED/i.test(err?.message ?? ''))
    return new ApiError(503, 'The database is temporarily unavailable. Please try again shortly.');
  // our own application errors raised inside PostgreSQL functions/triggers (message text is written by us, so it is safe)
  if (code === 'CC403') return new ApiError(403, err.message!);
  if (code === 'CC404') return new ApiError(404, err.message!);
  if (code === 'CC409') return new ApiError(409, err.message!);
  if (code === 'CC422') return new ApiError(422, err.message!);
  if (code === '42501') return new ApiError(403, 'You are not allowed to do that.');
  if (code === '23P01') return new ApiError(409, 'That venue is already booked by another approved event during this time slot.');
  if (code === '23505') {
    const c = err.constraint ?? '';
    const msg = c.includes('email') ? 'That e-mail address is already registered.' : c.includes('srn') ? 'That SRN is already registered.'
      : c.includes('registrations') ? 'You already have a registration for this event.' : c.includes('one_feedback') ? 'Feedback already submitted.' : 'That value already exists.';
    return new ApiError(409, msg);
  }
  if (code === '23514') return new ApiError(422, `A value breaks a database rule (${err.constraint ?? 'check constraint'}).`);
  if (code === '23503') return new ApiError(409, 'This record is linked to other records, or refers to something that does not exist.');
  if (code === '23502' || code === '22P02' || code === '22003' || code === '22007' || code === '22008') return new ApiError(422, 'One of the values is missing or malformed.');
  console.error('[api] unexpected error:', e);
  return new ApiError(500, 'Something went wrong on our side.');
}

export async function readBody<T>(req: NextRequest, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try { raw = await req.json(); } catch { throw new ApiError(400, 'Request body must be valid JSON.'); }
  return schema.parse(raw);
}
export const created = (body: unknown) => NextResponse.json(body, { status: 201 });

type Args = { req: NextRequest; s: Session; params: Record<string, string> };
type Ctx = { params: Promise<Record<string, string>> };

function guardOrigin(req: NextRequest) {      // CSRF defence in depth (cookie is also SameSite=Lax)
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const origin = req.headers.get('origin');
  if (origin && new URL(origin).host !== req.headers.get('host')) throw new ApiError(403, 'Cross-site request blocked.');
}

/** Authenticated route. `roles` is enforced HERE (fast fail) and again inside PostgreSQL (GRANTs / RLS / function checks). */
export function route(roles: Role[] | 'any', handler: (a: Args) => Promise<unknown>) {
  return async (req: NextRequest, ctx: Ctx) => {
    try {
      guardOrigin(req);
      const s = await getSession();
      if (!s) throw new ApiError(401, 'Please log in.');
      if (roles !== 'any' && !roles.includes(s.role)) throw new ApiError(403, 'Your role cannot use this endpoint.');
      const out = await handler({ req, s, params: await ctx.params });
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      const a = mapError(e);
      return NextResponse.json({ error: a.message, ...(a.extra ?? {}) }, { status: a.status });
    }
  };
}

/** Public route (login / register). */
export function publicRoute(handler: (a: { req: NextRequest }) => Promise<unknown>) {
  return async (req: NextRequest) => {
    try {
      guardOrigin(req);
      const out = await handler({ req });
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      const a = mapError(e);
      return NextResponse.json({ error: a.message, ...(a.extra ?? {}) }, { status: a.status });
    }
  };
}

export function idParam(v: string | undefined, name = 'id'): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new ApiError(400, `Invalid ${name}.`);
  return n;
}
