import { publicRoute } from '@/lib/api';
import { destroySession, getSession } from '@/lib/session';
import { logActivity } from '@/lib/mongo';

export const POST = publicRoute(async () => {
  const s = await getSession();
  await destroySession();
  if (s) await logActivity({ userId: s.userId, role: s.role }, 'LOGOUT');
  return { ok: true };
});
