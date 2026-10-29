import { ApiError, idParam, readBody, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { clubInput } from '@/lib/validation';
import { logActivity } from '@/lib/mongo';

// campus admin: any field. club admin: description / contact e-mail of an own club only (column GRANT + RLS enforce this).
export const PATCH = route(['CAMPUS_ADMIN', 'CLUB_ADMIN'], async ({ req, s, params }) => {
  const id = idParam(params.id); const v = await readBody(req, clubInput.partial());
  const n = await withUser(s, async c => s.role === 'CAMPUS_ADMIN'
    ? (await c.query(`UPDATE clubs SET name = COALESCE($2,name), description = COALESCE($3,description), contact_email = CASE WHEN $4::text IS NULL THEN contact_email ELSE NULLIF($4,'') END,
                      is_active = COALESCE($5,is_active) WHERE club_id = $1`, [id, v.name ?? null, v.description ?? null, v.contactEmail ?? null, v.isActive ?? null])).rowCount
    : (await c.query(`UPDATE clubs SET description = COALESCE($2,description), contact_email = CASE WHEN $3::text IS NULL THEN contact_email ELSE NULLIF($3,'') END WHERE club_id = $1`,
        [id, v.description ?? null, v.contactEmail ?? null])).rowCount);
  if (!n) throw new ApiError(404, 'Club not found, or you do not manage it.');
  await logActivity(s, 'CLUB_UPDATED', 'club', id); return { ok: true };
});
