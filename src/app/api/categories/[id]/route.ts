import { ApiError, idParam, readBody, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { categoryInput } from '@/lib/validation';
import { logActivity } from '@/lib/mongo';
export const PATCH = route(['CAMPUS_ADMIN'], async ({ req, s, params }) => {
  const id = idParam(params.id); const v = await readBody(req, categoryInput);
  // refuse to make a category its own ancestor (would create a cycle): walk up from the proposed parent
  if (v.parentCategoryId) {
    const bad = await withUser(s, async c => (await c.query(`WITH RECURSIVE up AS (SELECT category_id, parent_category_id FROM event_categories WHERE category_id = $1
        UNION ALL SELECT p.category_id, p.parent_category_id FROM event_categories p JOIN up ON p.category_id = up.parent_category_id) SELECT 1 FROM up WHERE category_id = $2`, [v.parentCategoryId, id])).rowCount);
    if (bad) throw new ApiError(422, 'A category cannot be placed under itself or one of its own sub-categories.');
  }
  const n = await withUser(s, async c => (await c.query('UPDATE event_categories SET name=$2, parent_category_id=$3 WHERE category_id=$1', [id, v.name, v.parentCategoryId ?? null])).rowCount);
  if (!n) throw new ApiError(404, 'Category not found.'); await logActivity(s, 'CATEGORY_UPDATED', 'category', id); return { ok: true };
});
