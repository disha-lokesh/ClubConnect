import { route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { campusReports } from '@/lib/reports';
import { aggregationEngine, reportActivityPerDay, reportAnnouncementsPerClub, reportFeedbackByEvent, reportFeedbackTags, reportTopActors } from '@/lib/mongo';

export const GET = route(['CAMPUS_ADMIN'], async ({ s }) => {
  const sql = await withUser(s, campusReports);
  let mongo: Record<string, unknown> | { error: string };
  try {
    mongo = { feedbackByEvent: await reportFeedbackByEvent(), feedbackTags: await reportFeedbackTags(8), activityPerDay: await reportActivityPerDay(14),
              topActors: await reportTopActors(5), announcementsPerClub: await reportAnnouncementsPerClub(), engine: aggregationEngine() };
  } catch (e) { mongo = { error: (e as Error).message }; }
  return { sql, mongo };
});
