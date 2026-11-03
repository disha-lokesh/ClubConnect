type Participation = {
  club: string;
  events: number | string;
  confirmed: number | string;
  attended: number | string;
  attendance_rate: number | string | null;
};

type Funnel = { status: string; events: number | string };
type Activity = { day: string; action: string; count: number | string };
type Feedback = { eventId: number | string; avgRating: number | string; reviews: number | string };
type Tag = { tag: string; count: number | string };
type Announcement = { clubId: number | string; posts: number | string; pinned: number | string };

type MongoReports = {
  feedback: Feedback[];
  tags: Tag[];
  activity: Activity[];
  announcements: Announcement[];
};

const numberValue = (value: number | string | null | undefined) => Number(value ?? 0);
const label = (value: string) => value.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());

function ChartCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="card report-chart">
      <div className="report-chart-heading"><h3>{title}</h3><p className="small muted">{description}</p></div>
      {children}
    </div>
  );
}

function HorizontalBars({ rows, value, tone = '' }: { rows: { name: string; value: number }[]; value: number; tone?: string }) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  if (!rows.length) return <div className="empty">No data available.</div>;
  return (
    <div className="bar-chart">
      {rows.map((row) => (
        <div className="bar-row" key={row.name}>
          <span title={row.name}>{row.name}</span>
          <div className="bar-track"><i className={tone} style={{ width: `${(row.value / max) * 100}%` }} /></div>
          <strong>{row.value}{value ? <small>/{value}</small> : null}</strong>
        </div>
      ))}
    </div>
  );
}

export default function ReportCharts({
  participation,
  funnel,
  activity,
  mongo,
}: {
  participation: Participation[];
  funnel: Funnel[];
  activity: Activity[];
  mongo?: MongoReports;
}) {
  const topClubs = participation.slice(0, 6);
  const activityByDay = activity.reduce<Record<string, number>>((days, row) => {
    days[row.day] = (days[row.day] ?? 0) + numberValue(row.count);
    return days;
  }, {});
  const activityDays = Object.entries(activityByDay).slice(-14);
  const maxActivity = Math.max(...activityDays.map(([, count]) => count), 1);
  const linePoints = activityDays.map(([, count], index) => {
    const x = activityDays.length === 1 ? 50 : (index / (activityDays.length - 1)) * 100;
    return `${x},${100 - (count / maxActivity) * 82 - 9}`;
  }).join(' ');
  const actionMix = Object.entries((mongo?.activity ?? []).reduce<Record<string, number>>((actions, row) => {
    actions[row.action] = (actions[row.action] ?? 0) + numberValue(row.count);
    return actions;
  }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ name: label(name), value }));
  const feedbackRows = (mongo?.feedback ?? []).slice(0, 6).map((row) => ({ name: `Event #${row.eventId}`, value: Number(numberValue(row.avgRating).toFixed(1)) }));
  const tagRows = (mongo?.tags ?? []).slice(0, 6).map((row) => ({ name: `#${row.tag}`, value: numberValue(row.count) }));
  const announcementRows = (mongo?.announcements ?? []).slice(0, 6).map((row) => ({ name: `Club #${row.clubId}`, value: numberValue(row.posts) }));
  const totalEvents = funnel.reduce((sum, row) => sum + numberValue(row.events), 0);
  const totalConfirmed = participation.reduce((sum, row) => sum + numberValue(row.confirmed), 0);
  const totalAttended = participation.reduce((sum, row) => sum + numberValue(row.attended), 0);
  const attendanceRate = totalConfirmed ? Math.round((totalAttended / totalConfirmed) * 100) : 0;
  const leadingClub = topClubs[0];
  const peakDay = activityDays.reduce<[string, number] | null>((peak, current) => !peak || current[1] > peak[1] ? current : peak, null);
  const leadingStatus = funnel.slice().sort((a, b) => numberValue(b.events) - numberValue(a.events))[0];

  return (
    <section aria-label="Report visualisations">
      <div className="report-hero card">
        <div><span className="eyebrow">Campus overview</span><h2>Understand what is happening at a glance</h2><p className="muted">Use the highlights below to spot demand, engagement, and areas that need attention.</p></div>
        <div className="report-hero-mark" aria-hidden="true">↗</div>
      </div>
      <div className="grid g4 report-stats">
        <div className="card stat"><b>{participation.length}</b><span>Active clubs</span><em>with approved events</em></div>
        <div className="card stat"><b>{totalEvents}</b><span>Events</span><em>excluding drafts</em></div>
        <div className="card stat"><b>{totalConfirmed}</b><span>Confirmed registrations</span><em>across all clubs</em></div>
        <div className="card stat"><b>{attendanceRate}%</b><span>Attendance rate</span><em>confirmed to attended</em></div>
      </div>
      <div className="insight-strip">
        <div><span className="insight-icon">★</span><p><strong>{leadingClub ? `${leadingClub.club} leads participation` : 'No leading club yet'}</strong><br /><span className="muted">{leadingClub ? `${numberValue(leadingClub.confirmed)} confirmed registrations` : 'Add approved events to see a leader.'}</span></p></div>
        <div><span className="insight-icon">●</span><p><strong>{leadingStatus ? `${label(leadingStatus.status)} is the largest pipeline stage` : 'Pipeline is empty'}</strong><br /><span className="muted">{leadingStatus ? `${numberValue(leadingStatus.events)} events currently` : 'No workflow data available.'}</span></p></div>
        <div><span className="insight-icon">↗</span><p><strong>{peakDay ? `${peakDay[0]} was the busiest day` : 'No recent activity'}</strong><br /><span className="muted">{peakDay ? `${peakDay[1]} recorded actions` : 'MongoDB activity data is unavailable.'}</span></p></div>
      </div>
      <div className="grid g2">
        <ChartCard title="Club participation" description="Confirmed registrations by club">
          <HorizontalBars rows={topClubs.map((row) => ({ name: row.club, value: numberValue(row.confirmed) }))} value={0} />
        </ChartCard>
        <ChartCard title="Event pipeline" description="Current events by workflow status">
          <HorizontalBars rows={funnel.map((row) => ({ name: label(row.status), value: numberValue(row.events) }))} value={0} tone="bar-alt" />
        </ChartCard>
        <ChartCard title="Activity trend" description="Daily actions across the last 14 days">
          {activityDays.length === 0 ? <div className="empty">No activity data.</div> : <div className="line-chart">
            <svg viewBox="0 0 100 100" role="img" aria-label="Daily activity trend"><line x1="0" y1="91" x2="100" y2="91" className="chart-axis" /><polyline points={linePoints} className="chart-line" />
              {activityDays.map(([day, count], index) => { const x = activityDays.length === 1 ? 50 : (index / (activityDays.length - 1)) * 100; const y = 100 - (count / maxActivity) * 82 - 9; return <circle key={day} cx={x} cy={y} r="1.8" className="chart-dot" />; })}
            </svg>
            <div className="chart-labels"><span>{activityDays[0][0]}</span><strong>{Math.max(...activityDays.map(([, count]) => count))} peak actions</strong><span>{activityDays[activityDays.length - 1][0]}</span></div>
          </div>}
        </ChartCard>
        <ChartCard title="Action mix" description="What users did during the last 14 days">
          <HorizontalBars rows={actionMix} value={0} tone="bar-warm" />
        </ChartCard>
        <ChartCard title="Feedback ratings" description="Average rating by event (out of 5)">
          <HorizontalBars rows={feedbackRows} value={5} tone="bar-good" />
        </ChartCard>
        <ChartCard title="Popular feedback tags" description="Most-mentioned themes in feedback">
          <HorizontalBars rows={tagRows} value={0} tone="bar-alt" />
        </ChartCard>
        <ChartCard title="Announcements by club" description="Posts published in the campus feed">
          <HorizontalBars rows={announcementRows} value={0} tone="bar-warm" />
        </ChartCard>
      </div>
    </section>
  );
}
