import { AUTOMATION_POLICY } from './automation';

/** A preview only: no sending, approval, storage or browser timer is performed. */
export interface SendPlanInput {
  sendAt: string;
  timeZone: string;
  spacingMinutes: number;
  count: number;
  businessHours?: boolean;
  spreadAcrossDays?: boolean;
  reserved?: { sendAt: string; active: boolean; countsTowardDailyLimit: boolean }[];
}

const minute = 60_000, day = 86_400_000, dailyLimit = 20;
interface LocalTime { year: number; month: number; day: number; hour: number; minute: number; second: number }

function instant(value: unknown): number {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    throw new Error('Choose a complete UTC sending date and time.');
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) throw new Error('Choose a valid UTC sending date and time.');
  return parsed;
}

function calendarTime(value: LocalTime): number {
  // setUTCFullYear avoids Date.UTC’s special interpretation of years 00–99.
  const date = new Date(0);
  date.setUTCFullYear(value.year, value.month - 1, value.day);
  date.setUTCHours(value.hour, value.minute, value.second, 0);
  return date.getTime();
}

function localDate(format: Intl.DateTimeFormat, at: number): LocalTime {
  const values = Object.fromEntries(format.formatToParts(at).map(part => [part.type, part.value]));
  const parts = { year: Number(values.year), month: Number(values.month), day: Number(values.day),
    hour: Number(values.hour), minute: Number(values.minute), second: Number(values.second) };
  if (Object.values(parts).some(value => !Number.isFinite(value))) throw new Error('This time zone could not be used for planning.');
  return parts;
}

function nextDate(value: LocalTime): LocalTime {
  const date = new Date(calendarTime({ ...value, day: value.day + 1, hour: 9, minute: 0, second: 0 }));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour: 9, minute: 0, second: 0 };
}

function weekend(value: LocalTime): boolean {
  const weekday = new Date(calendarTime(value)).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/** Resolve the opening using real zone offsets on both sides of a transition.
 * Repeated openings choose the earliest future occurrence; a missing opening
 * rolls forward. A skipped calendar day is rechecked by officeTime below.
 */
function opening(format: Intl.DateTimeFormat, target: LocalTime, notBefore: number): number {
  const wanted = calendarTime(target);
  const offsets = new Set([-36, 0, 36].map(hours => {
    const sample = wanted + hours * 3_600_000;
    return calendarTime(localDate(format, sample)) - sample;
  }));
  const candidates = [...offsets].map(offset => wanted - offset).filter(value => value >= notBefore).sort((left, right) => left - right);
  const exact = candidates.find(value => calendarTime(localDate(format, value)) === wanted);
  if (exact !== undefined) return exact;
  const forward = candidates.find(value => calendarTime(localDate(format, value)) > wanted);
  if (forward !== undefined) return forward;
  throw new Error('The next office opening could not be resolved in this time zone. Choose another start time.');
}

function officeTime(format: Intl.DateTimeFormat, at: number, horizon: number): number {
  let candidate = at;
  // Normal DST changes resolve in one pass. The extra bound also covers a
  // political skipped day without scanning every minute or looping forever.
  for (let attempts = 0; attempts < 8; attempts++) {
    if (candidate > horizon) throw new Error('Keep the complete sending plan within 30 days of its first requested time.');
    const local = localDate(format, candidate);
    if (!weekend(local) && local.hour >= 9 && local.hour < 17) return candidate;
    let target: LocalTime = { ...local, hour: 9, minute: 0, second: 0 };
    if (weekend(local) || local.hour >= 17) target = nextDate(target);
    for (let days = 0; weekend(target) && days < 7; days++) target = nextDate(target);
    candidate = opening(format, target, candidate);
  }
  throw new Error('A valid office-hours plan could not be resolved. Choose another start time.');
}

/** Plan exact UTC slots before owner confirmation.
 * Business hours use the supplied IANA zone’s calendar, while the existing
 * twenty-send limit uses UTC dates. Holidays are not inferred. Intl’s installed
 * time-zone data controls future offsets; a changed reservation/time-zone rule
 * requires a fresh preview. Inputs and all work are bounded and never mutated.
 */
export function planSendTimes(input: SendPlanInput): string[] {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Number.isInteger(input.count) || input.count < 1 || input.count > 100) {
    throw new Error('Choose between 1 and 100 messages for a sending plan.');
  }
  if (!Number.isInteger(input.spacingMinutes) || input.spacingMinutes < AUTOMATION_POLICY.minimumSpacingMinutes || input.spacingMinutes > 1440) {
    throw new Error(`Space messages by ${AUTOMATION_POLICY.minimumSpacingMinutes} to 1,440 minutes.`);
  }
  if ((input.businessHours !== undefined && typeof input.businessHours !== 'boolean')
    || (input.spreadAcrossDays !== undefined && typeof input.spreadAcrossDays !== 'boolean')) throw new Error('Choose valid office-hours and day-spreading settings.');
  if (typeof input.timeZone !== 'string' || !input.timeZone || input.timeZone.length > 100) throw new Error('Choose a supported IANA time zone.');
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat('en-CA', { timeZone: input.timeZone, calendar: 'iso8601', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  } catch { throw new Error('Choose a supported IANA time zone.'); }
  if (input.reserved !== undefined && (!Array.isArray(input.reserved) || input.reserved.length > 500)) throw new Error('A sending plan can check at most 500 existing reservations.');
  const first = instant(input.sendAt), horizon = first + 30 * day;
  const counts = new Map<string, number>(), active: number[] = [];
  for (const reserved of input.reserved ?? []) {
    if (!reserved || typeof reserved !== 'object' || Array.isArray(reserved) || typeof reserved.active !== 'boolean' || typeof reserved.countsTowardDailyLimit !== 'boolean') {
      throw new Error('Refresh the existing sending reservations before planning.');
    }
    const at = instant(reserved.sendAt);
    if (reserved.active) active.push(at);
    if (reserved.countsTowardDailyLimit) {
      const key = reserved.sendAt.slice(0, 10);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  active.sort((left, right) => left - right);
  const result: string[] = [];
  let candidate = first, passes = 0;
  while (result.length < input.count) {
    if (++passes > 2048 || candidate > horizon) throw new Error('Keep the complete sending plan within 30 days of its first requested time.');
    if (input.businessHours) candidate = officeTime(format, candidate, horizon);
    const value = new Date(candidate).toISOString(), key = value.slice(0, 10);
    if (value.length !== 24 || candidate > horizon) throw new Error('Keep the complete sending plan within 30 days of its first requested time.');
    if ((counts.get(key) ?? 0) >= dailyLimit) {
      if (!input.spreadAcrossDays) throw new Error(`The 20-email UTC daily limit is full on ${key}. Enable spreading across days or choose a later start.`);
      candidate = Math.floor(candidate / day) * day + day;
      continue;
    }
    const minimumGap = AUTOMATION_POLICY.minimumSpacingMinutes * minute;
    const overlap = active.find(existing => Math.abs(existing - candidate) < minimumGap);
    if (overlap !== undefined) {
      if (!input.spreadAcrossDays) throw new Error(`A sending time overlaps an active reservation. Enable spreading or choose a start at least ${AUTOMATION_POLICY.minimumSpacingMinutes} minutes away.`);
      candidate = overlap + minimumGap;
      continue;
    }
    result.push(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    candidate += input.spacingMinutes * minute;
  }
  return result;
}
