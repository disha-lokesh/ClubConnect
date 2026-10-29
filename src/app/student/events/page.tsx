import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { listPublished, referenceData, type Filters } from '@/lib/queries';
import { EventCard, Empty } from '@/components/ui';

type SP = Record<string, string | undefined>;
export default async function Catalogue({ searchParams }: { searchParams: Promise<SP> }) {
  const s = await requireRole('STUDENT'); const sp = await searchParams;
  const f: Filters = {
    q: sp.q || undefined, clubId: sp.club ? Number(sp.club) : undefined, categoryId: sp.category ? Number(sp.category) : undefined,
    from: /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? '') ? sp.from : undefined, to: /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? '') ? sp.to : undefined,
    maxFee: sp.maxFee ? Number(sp.maxFee) : undefined, when: (['upcoming', 'past', 'all'] as const).find(w => w === sp.when) ?? 'upcoming', openOnly: sp.open === '1',
  };
  const { events, ref } = await withUser(s, async c => ({ events: await listPublished(c, f), ref: await referenceData(c) }));
  return (
    <>
      <h1>Events</h1><p className="muted">Published events from every club. Searching a category also finds events in its sub-categories.</p>
      <form className="card filters" method="get">
        <div><label htmlFor="q">Search</label><input id="q" name="q" defaultValue={sp.q} placeholder="e.g. photograph, hackathon" /></div>
        <div><label htmlFor="club">Club</label><select id="club" name="club" defaultValue={sp.club ?? ''}><option value="">All clubs</option>{ref.clubs.map(c => <option key={c.club_id} value={c.club_id}>{c.name}</option>)}</select></div>
        <div><label htmlFor="category">Category</label><select id="category" name="category" defaultValue={sp.category ?? ''}><option value="">All categories</option>{ref.categories.map(c => <option key={c.category_id} value={c.category_id}>{'— '.repeat(c.depth)}{c.name}</option>)}</select></div>
        <div><label htmlFor="from">From</label><input id="from" type="date" name="from" defaultValue={sp.from} /></div>
        <div><label htmlFor="to">To</label><input id="to" type="date" name="to" defaultValue={sp.to} /></div>
        <div><label htmlFor="maxFee">Max fee (₹)</label><input id="maxFee" type="number" min={0} name="maxFee" defaultValue={sp.maxFee} placeholder="0 = free only" /></div>
        <div><label htmlFor="when">Show</label><select id="when" name="when" defaultValue={f.when}><option value="upcoming">Upcoming</option><option value="past">Past</option><option value="all">All</option></select></div>
        <div className="check"><input id="open" type="checkbox" name="open" value="1" defaultChecked={f.openOnly} /><label htmlFor="open">Open for registration only</label></div>
        <div className="row"><button className="btn primary" type="submit">Apply</button><a className="btn" href="/student/events">Reset</a></div>
      </form>
      <p className="small muted">{events.length} event{events.length === 1 ? '' : 's'} found</p>
      {events.length === 0 ? <Empty>No events match these filters. Try widening your search.</Empty> : <div className="grid g3">{events.map(e => <EventCard key={e.event_id} e={e} href={`/student/events/${e.event_id}`} />)}</div>}
    </>
  );
}
