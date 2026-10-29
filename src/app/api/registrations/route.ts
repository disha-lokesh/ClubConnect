import { route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { myRegistrations } from '@/lib/queries';
export const GET = route(['STUDENT'], async ({ s }) => ({ registrations: await withUser(s, myRegistrations) }));
