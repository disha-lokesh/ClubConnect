import { idParam, route } from '@/lib/api';
import { withUser } from '@/lib/db';
import { participants } from '@/lib/queries';

export const GET = route(['CLUB_ADMIN', 'CAMPUS_ADMIN'], async ({ s, params }) => ({ participants: await withUser(s, c => participants(c, idParam(params.id))) }));
