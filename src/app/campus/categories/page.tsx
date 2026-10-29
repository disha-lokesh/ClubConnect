import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { referenceData } from '@/lib/queries';
import ApiForm from '@/components/ApiForm';

export default async function Categories() {
  const s = await requireRole('CAMPUS_ADMIN');
  const { categories } = await withUser(s, referenceData);
  const opts = categories.map(c => ({ value: c.category_id, label: c.path as string }));
  return (
    <>
      <h1>Event categories</h1><p className="muted">Categories form a tree (self-referencing table). The tree below is produced by a recursive CTE.</p>
      <div className="card"><h2>Add a category</h2><ApiForm action="/api/categories" submit="Add category" reset successMessage="Category added." fields={[{ name: 'name', label: 'Name', required: true }, { name: 'parentCategoryId', label: 'Parent', type: 'select', options: opts }]} /></div>
      <div className="card"><ul className="tree">{categories.map(c => <li key={c.category_id} style={{ marginLeft: `${c.depth * 1.4}rem` }}>
        <details><summary>{c.depth > 0 ? '└ ' : ''}{c.name}</summary><ApiForm action={`/api/categories/${c.category_id}`} method="PATCH" submit="Save"
          fields={[{ name: 'name', label: 'Name', required: true, defaultValue: c.name }, { name: 'parentCategoryId', label: 'Parent', type: 'select', options: opts.filter(o => o.value !== c.category_id), defaultValue: c.parent_category_id }]} /></details></li>)}</ul></div>
    </>
  );
}
