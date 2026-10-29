import { created, readBody, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { categoryInput } from '@/lib/validation';
import { logActivity } from '@/lib/mongo';
export const GET = route('any', async ({ s }) => ({ categories: await withUser(s, async c => (await c.query('SELECT category_id, name, parent_category_id, depth, path FROM category_tree ORDER BY path')).rows) }));
export const POST = route(['CAMPUS_ADMIN'], async ({ req, s }) => {
  const v = await readBody(req, categoryInput);
  const id = await withUser(s, async c => (await c.query('INSERT INTO event_categories (name, parent_category_id) VALUES ($1,$2) RETURNING category_id', [v.name, v.parentCategoryId ?? null])).rows[0].category_id);
  await logActivity(s, 'CATEGORY_CREATED', 'category', id); return created({ categoryId: id });
});
