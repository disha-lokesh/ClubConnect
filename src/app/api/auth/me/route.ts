import { route } from '@/lib/api';
export const GET = route('any', async ({ s }) => ({ userId: s.userId, role: s.role, name: s.name }));
