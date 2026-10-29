import ApiForm from './ApiForm';
import { toLocalInput } from '@/lib/format';
import type { EventRow } from '@/lib/queries';

type Ref = { clubs?: { club_id: number; name: string }[]; venues: { venue_id: number; name: string; building: string; capacity: number; is_active: boolean }[]; categories: { category_id: number; name: string; depth: number }[] };
export default function EventForm({ refData, clubs, event }: { refData: Ref; clubs?: { club_id: number; name: string }[]; event?: EventRow }) {
  const fields = [
    ...(!event ? [{ name: 'clubId', label: 'Club', type: 'select' as const, required: true, options: (clubs ?? []).map(c => ({ value: c.club_id, label: c.name })), defaultValue: clubs?.length === 1 ? clubs[0].club_id : undefined }] : []),
    { name: 'title', label: 'Title', required: true, maxLength: 150, defaultValue: event?.title, wide: true },
    { name: 'description', label: 'Description', type: 'textarea' as const, maxLength: 5000, defaultValue: event?.description },
    { name: 'categoryId', label: 'Category', type: 'select' as const, required: true, options: refData.categories.map(c => ({ value: c.category_id, label: `${'— '.repeat(c.depth)}${c.name}` })), defaultValue: event?.category_id },
    { name: 'venueId', label: 'Venue', type: 'select' as const, required: true, options: refData.venues.filter(v => v.is_active).map(v => ({ value: v.venue_id, label: `${v.name} (${v.building}, seats ${v.capacity})` })), defaultValue: event?.venue_id },
    { name: 'startTime', label: 'Starts (IST)', type: 'datetime' as const, required: true, defaultValue: event ? toLocalInput(event.start_time) : undefined },
    { name: 'endTime', label: 'Ends (IST)', type: 'datetime' as const, required: true, defaultValue: event ? toLocalInput(event.end_time) : undefined },
    { name: 'registrationDeadline', label: 'Registration deadline (IST)', type: 'datetime' as const, required: true, defaultValue: event ? toLocalInput(event.registration_deadline) : undefined, hint: 'Must be on or before the start time' },
    { name: 'capacity', label: 'Capacity', type: 'number' as const, required: true, min: 1, defaultValue: event?.capacity ?? 50, hint: 'Cannot exceed the venue capacity' },
    { name: 'fee', label: 'Fee (₹)', type: 'number' as const, required: true, min: 0, step: '0.01', defaultValue: event?.fee ?? 0 },
    { name: 'eligibility', label: 'Who can register', type: 'select' as const, required: true, options: [{ value: 'OPEN', label: 'Any student' }, { value: 'CLUB_MEMBERS', label: 'Club members only' }], defaultValue: event?.eligibility ?? 'OPEN' },
    { name: 'manualApproval', label: 'I approve each registration manually', type: 'checkbox' as const, defaultValue: event?.manual_approval ?? false },
  ];
  return event
    ? <ApiForm action={`/api/events/${event.event_id}`} method="PATCH" fields={fields} submit="Save changes" successMessage="Draft saved." />
    : <ApiForm action="/api/events" fields={fields} submit="Create draft" redirect="/club/events/{eventId}" />;
}
