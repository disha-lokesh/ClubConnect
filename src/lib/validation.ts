import { z } from 'zod';

export const password = z.string().min(8, 'at least 8 characters').max(72, 'at most 72 characters')
  .regex(/[a-z]/, 'needs a lowercase letter').regex(/[A-Z]/, 'needs an uppercase letter').regex(/[0-9]/, 'needs a digit');

export const loginInput = z.object({ email: z.string().trim().email().max(254), password: z.string().min(1).max(72) });
export const registerInput = z.object({
  email: z.string().trim().email().max(254), password, fullName: z.string().trim().min(2).max(120),
  srn: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{6,20}$/, 'letters and digits, 6-20 characters'),
  department: z.string().trim().min(2).max(60), yearOfStudy: z.number().int().min(1).max(6),
  phone: z.string().trim().regex(/^[0-9+ -]{7,15}$/, 'digits, +, space or -').optional().or(z.literal('')),
});
const iso = z.iso.datetime({ offset: true });
export const eventInput = z.object({
  categoryId: z.number().int().positive(), venueId: z.number().int().positive(),
  title: z.string().trim().min(3).max(150), description: z.string().trim().max(5000).default(''),
  startTime: iso, endTime: iso, registrationDeadline: iso,
  capacity: z.number().int().min(1).max(100000), fee: z.number().min(0).max(100000),
  eligibility: z.enum(['OPEN', 'CLUB_MEMBERS']), manualApproval: z.boolean(),
});
export const eventCreateInput = eventInput.extend({ clubId: z.number().int().positive() });
export const reasonInput = z.object({ reason: z.string().trim().min(3, 'please give a reason').max(500) });
export const reviewInput = z.object({ approve: z.boolean(), comment: z.string().trim().max(500).optional() });
export const decideInput = z.object({ approve: z.boolean() });
export const attendanceInput = z.object({ present: z.boolean() });
export const profileInput = z.object({
  fullName: z.string().trim().min(2).max(120).optional(), department: z.string().trim().min(2).max(60).optional(),
  yearOfStudy: z.number().int().min(1).max(6).optional(), phone: z.string().trim().regex(/^[0-9+ -]{7,15}$/).or(z.literal('')).optional(),
}).refine(v => Object.keys(v).length > 0, 'nothing to update');
export const clubInput = z.object({ name: z.string().trim().min(2).max(100), description: z.string().trim().max(1000).default(''), contactEmail: z.string().trim().email().max(254).or(z.literal('')).optional(), isActive: z.boolean().optional() });
export const venueInput = z.object({ name: z.string().trim().min(2).max(80), building: z.string().trim().min(2).max(80), capacity: z.number().int().min(1).max(100000), isActive: z.boolean().optional() });
export const categoryInput = z.object({ name: z.string().trim().min(2).max(60), parentCategoryId: z.number().int().positive().nullable().optional() });
export const staffInput = z.object({ email: z.string().trim().email().max(254), password, fullName: z.string().trim().min(2).max(120),
  role: z.enum(['CLUB_ADMIN', 'CAMPUS_ADMIN']), clubId: z.number().int().positive().optional() });
export const assignAdminInput = z.object({ userId: z.number().int().positive() });
