import bcrypt from 'bcryptjs';
import type { Role } from './db';
export const hashPassword = (p: string) => bcrypt.hash(p, 10);
export const verifyPassword = bcrypt.compare;
// compared against when the e-mail is unknown, so "unknown user" and "wrong password" take the same time
export const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
export const HOME: Record<Role, string> = { STUDENT: '/student/calendar', CLUB_ADMIN: '/club/calendar', CAMPUS_ADMIN: '/campus/calendar' };
