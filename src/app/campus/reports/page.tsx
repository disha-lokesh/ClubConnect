import { requireRole } from '@/lib/guards';
import { withUser } from '@/lib/db';
import { campusReports } from '@/lib/reports';
import { aggregationEngine, reportActivityPerDay, reportAnnouncementsPerClub, reportFeedbackByEvent, reportFeedbackTags, reportTopActors } from '@/lib/mongo';
import DataTable from '@/components/DataTable';
import { Alert } from '@/components/ui';

export default async function Reports() {
  const s = await requireRole('CAMPUS_ADMIN');
  const sql = await withUser(s, campusReports);
  let m: { fb: any[]; tags: any[]; perDay: any[]; actors: any[]; ann: any[]; engine: string } | null = null;
  try { const [fb, tags, perDay, actors, ann] = await Promise.all([reportFeedbackByEvent(), reportFeedbackTags(8), reportActivityPerDay(14), reportTopActors(5), reportAnnouncementsPerClub()]); m = { fb, tags, perDay, actors, ann, engine: aggregationEngine() }; } catch { /* shown below */ }
  return (
    <>
      <h1>Reports</h1>
      <h2>From PostgreSQL</h2>
      <div className="grid g2">
        <div className="card"><h3>Club participation <span className="small muted">(JOIN, GROUP BY, HAVING)</span></h3><DataTable rows={sql.clubParticipation} cols={{ club: 'Club', events: 'Events', confirmed: 'Confirmed', attended: 'Attended', attendance_rate: 'Attendance %' }} /></div>
        <div className="card"><h3>Category roll-up <span className="small muted">(recursive CTE)</span></h3><DataTable rows={sql.categoryRollup} cols={{ category: 'Top-level category', events: 'Events', confirmed: 'Confirmed' }} /></div>
        <div className="card"><h3>Events fuller than their club average <span className="small muted">(correlated subquery)</span></h3><DataTable rows={sql.aboveClubAverage} cols={{ title: 'Event', club: 'Club', fill_percent: 'Fill %', club_average: 'Club avg %' }} /></div>
        <div className="card"><h3>Venue utilisation</h3><DataTable rows={sql.venueUtilisation} cols={{ venue: 'Venue', capacity: 'Capacity', events: 'Events', hours_booked: 'Hours booked' }} /></div>
        <div className="card"><h3>Event pipeline</h3><DataTable rows={sql.eventFunnel} cols={{ status: 'Status', events: 'Events' }} /></div>
        <div className="card"><h3>Most active students <span className="small muted">(window function)</span></h3><DataTable rows={sql.topStudents} cols={{ rank: 'Rank', student: 'Student', department: 'Dept', events_attended: 'Attended' }} /></div>
      </div>
      <h2>From MongoDB <span className="small muted">(aggregation pipelines)</span></h2>
      {!m ? <Alert kind="warn">MongoDB is not reachable, so these reports are unavailable. PostgreSQL reports above are unaffected.</Alert> : (
        <>
          {m.engine !== 'server' && <Alert kind="info">Compatibility mode: aggregations ran in memory (development database). On a real MongoDB server they run inside the database.</Alert>}
          <div className="grid g2">
            <div className="card"><h3>Feedback per event</h3><DataTable rows={m.fb} cols={{ eventId: 'Event #', avgRating: 'Avg rating', reviews: 'Reviews', five: '5-star', low: '1-2 star' }} /></div>
            <div className="card"><h3>Popular feedback tags</h3><DataTable rows={m.tags} cols={{ tag: 'Tag', count: 'Mentions' }} /></div>
            <div className="card"><h3>Activity per day and action (14 days)</h3><DataTable rows={m.perDay.slice(0, 15)} cols={{ day: 'Day', action: 'Action', count: 'Count' }} /></div>
            <div className="card"><h3>Most active users</h3><DataTable rows={m.actors} cols={{ actorUserId: 'User id', actorRole: 'Role', actions: 'Actions', lastSeen: 'Last seen' }} /></div>
            <div className="card"><h3>Announcements per club</h3><DataTable rows={m.ann} cols={{ clubId: 'Club id', posts: 'Posts', pinned: 'Pinned', latest: 'Latest' }} /></div>
          </div>
        </>)}
    </>
  );
}
