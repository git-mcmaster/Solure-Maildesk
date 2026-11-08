import { describe, expect, it } from 'vitest';
import { planSendTimes, type SendPlanInput } from '../../src/shared/send-plan';

const base: SendPlanInput = { sendAt: '2026-11-09T14:00:00.000Z', timeZone: 'America/New_York', spacingMinutes: 2, count: 2 };
const reserved = (sendAt: string, active = true, countsTowardDailyLimit = true) => ({ sendAt, active, countsTowardDailyLimit });

describe('shared sending-time preview', () => {
  it('preserves exact elapsed spacing and the first instant with both optional policies off', () => {
    expect(planSendTimes(base)).toEqual(['2026-11-09T14:00:00.000Z', '2026-11-09T14:02:00.000Z']);
    expect(planSendTimes({ ...base, sendAt: '2026-11-07T23:59:45.250Z', spacingMinutes: 2, count: 3 })).toEqual([
      '2026-11-07T23:59:45.250Z', '2026-11-08T00:01:45.250Z', '2026-11-08T00:03:45.250Z',
    ]);
  });

  it('includes 09:00 and excludes 17:00, rolling earlier starts forward without changing an eligible start', () => {
    expect(planSendTimes({ ...base, sendAt: '2026-11-09T13:59:59.999Z', count: 1, businessHours: true })).toEqual(['2026-11-09T14:00:00.000Z']);
    expect(planSendTimes({ ...base, sendAt: '2026-11-09T14:00:45.250Z', count: 1, businessHours: true })).toEqual(['2026-11-09T14:00:45.250Z']);
    expect(planSendTimes({ ...base, sendAt: '2026-11-09T22:00:00.000Z', count: 1, businessHours: true })).toEqual(['2026-11-10T14:00:00.000Z']);
  });

  it('rolls past the weekend and resumes at local opening while preserving minimum elapsed spacing', () => {
    expect(planSendTimes({ ...base, sendAt: '2026-11-06T21:30:00.000Z', spacingMinutes: 60, count: 3, businessHours: true })).toEqual([
      '2026-11-06T21:30:00.000Z', '2026-11-09T14:00:00.000Z', '2026-11-09T15:00:00.000Z',
    ]);
    expect(planSendTimes({ ...base, sendAt: '2026-11-07T14:00:00.000Z', count: 1, businessHours: true })).toEqual(['2026-11-09T14:00:00.000Z']);
  });

  it('uses the changed US spring and autumn UTC offsets for Monday openings', () => {
    expect(planSendTimes({ ...base, sendAt: '2026-03-06T21:30:00.000Z', spacingMinutes: 60, businessHours: true })).toEqual([
      '2026-03-06T21:30:00.000Z', '2026-03-09T13:00:00.000Z',
    ]);
    expect(planSendTimes({ ...base, sendAt: '2026-10-30T20:30:00.000Z', spacingMinutes: 60, businessHours: true })).toEqual([
      '2026-10-30T20:30:00.000Z', '2026-11-02T14:00:00.000Z',
    ]);
  });

  it('keeps real elapsed spacing across a repeated US clock hour when office hours are off', () => {
    expect(planSendTimes({ ...base, sendAt: '2026-11-01T05:30:00.000Z', spacingMinutes: 60 })).toEqual([
      '2026-11-01T05:30:00.000Z', '2026-11-01T06:30:00.000Z',
    ]);
  });

  it('handles both Australian DST directions and the UTC date before a local Monday opening', () => {
    expect(planSendTimes({ ...base, timeZone: 'Australia/Sydney', sendAt: '2026-04-03T05:30:00.000Z', spacingMinutes: 60, businessHours: true })).toEqual([
      '2026-04-03T05:30:00.000Z', '2026-04-05T23:00:00.000Z',
    ]);
    expect(planSendTimes({ ...base, timeZone: 'Australia/Sydney', sendAt: '2026-10-02T06:30:00.000Z', spacingMinutes: 60, businessHours: true })).toEqual([
      '2026-10-02T06:30:00.000Z', '2026-10-04T22:00:00.000Z',
    ]);
  });

  it('handles a half-hour DST transition and a political skipped calendar day without a minute scan', () => {
    expect(planSendTimes({ ...base, timeZone: 'Australia/Lord_Howe', sendAt: '2026-10-02T06:00:00.000Z', spacingMinutes: 60, businessHours: true })).toEqual([
      '2026-10-02T06:00:00.000Z', '2026-10-04T22:00:00.000Z',
    ]);
    expect(planSendTimes({ ...base, timeZone: 'Pacific/Apia', sendAt: '2011-12-30T02:30:00.000Z', spacingMinutes: 60, businessHours: true })).toEqual([
      '2011-12-30T02:30:00.000Z', '2012-01-01T19:00:00.000Z',
    ]);
  });

  it('rejects a 21-email UTC day as one complete error unless spreading is selected', () => {
    expect(() => planSendTimes({ ...base, count: 21 })).toThrow('20-email UTC daily limit');
    const result = planSendTimes({ ...base, count: 21, spreadAcrossDays: true });
    expect(result).toHaveLength(21);
    expect(result[19]).toBe('2026-11-09T14:38:00.000Z');
    expect(result[20]).toBe('2026-11-10T00:00:00.000Z');
  });

  it('spreads a full 100-message selection across eligible days at the existing daily cap', () => {
    const result = planSendTimes({ ...base, count: 100, businessHours: true, spreadAcrossDays: true });
    expect(result).toHaveLength(100);
    expect(result[20]).toBe('2026-11-10T14:00:00.000Z');
    expect(result[99]).toBe('2026-11-13T14:38:00.000Z');
    const counts = result.reduce<Record<string, number>>((all, at) => { all[at.slice(0, 10)] = (all[at.slice(0, 10)] ?? 0) + 1; return all; }, {});
    expect(Object.values(counts)).toEqual([20, 20, 20, 20, 20]);
  });

  it('counts prior accepted/inactive reservations but does not count cancelled unsubmitted ones', () => {
    const existing = Array.from({ length: 19 }, (_, index) => reserved(`2026-11-09T00:${String(index).padStart(2, '0')}:00.000Z`, false));
    existing.push(reserved('2026-11-09T15:00:00.000Z', false, false));
    expect(planSendTimes({ ...base, count: 3, reserved: existing, spreadAcrossDays: true })).toEqual([
      '2026-11-09T14:00:00.000Z', '2026-11-10T00:00:00.000Z', '2026-11-10T00:02:00.000Z',
    ]);
  });

  it('moves around active reservations with a full two-minute boundary and rejects an overlap without spreading', () => {
    const existing = [reserved('2026-11-09T14:00:30.000Z', true, false), reserved('2026-11-09T14:01:30.000Z', true, false)];
    expect(() => planSendTimes({ ...base, reserved: existing })).toThrow('overlaps an active reservation');
    expect(planSendTimes({ ...base, reserved: existing, spreadAcrossDays: true })).toEqual([
      '2026-11-09T14:03:30.000Z', '2026-11-09T14:05:30.000Z',
    ]);
    expect(planSendTimes({ ...base, count: 1, reserved: [reserved('2026-11-09T13:58:00.000Z', true, false)] })).toEqual([base.sendAt]);
  });

  it('rechecks office hours after an overlap jump and checks UTC capacity after the local opening shift', () => {
    expect(planSendTimes({ ...base, sendAt: '2026-11-06T21:59:00.000Z', count: 1, businessHours: true, spreadAcrossDays: true,
      reserved: [reserved('2026-11-06T21:59:30.000Z', true, false)] })).toEqual(['2026-11-09T14:00:00.000Z']);
    const existing = Array.from({ length: 20 }, (_, index) => reserved(`2026-11-10T00:${String(index).padStart(2, '0')}:00.000Z`, false));
    expect(planSendTimes({ ...base, timeZone: 'America/Los_Angeles', sendAt: '2026-11-10T00:30:00.000Z', count: 1,
      businessHours: true, spreadAcrossDays: true, reserved: existing })).toEqual(['2026-11-11T00:00:00.000Z']);
  });

  it('preserves inputs and is deterministic for an unchanged reservation snapshot', () => {
    const input = { ...base, businessHours: true, spreadAcrossDays: true, reserved: [reserved('2026-11-09T14:00:30.000Z')] };
    const before = JSON.stringify(input);
    const first = planSendTimes(input);
    expect(planSendTimes(input)).toEqual(first);
    expect(JSON.stringify(input)).toBe(before);
    expect(first[0]).toBe('2026-11-09T14:02:30.000Z');
  });

  it('allows the exact 30-day horizon and rejects a complete plan beyond it', () => {
    const result = planSendTimes({ ...base, timeZone: 'UTC', spacingMinutes: 1440, count: 31 });
    expect(result.at(-1)).toBe('2026-12-09T14:00:00.000Z');
    expect(() => planSendTimes({ ...base, timeZone: 'UTC', spacingMinutes: 1440, count: 32 })).toThrow('within 30 days');
    expect(() => planSendTimes({ ...base, timeZone: 'UTC', spacingMinutes: 1440, count: 31, businessHours: true })).toThrow('within 30 days');
  });

  it('bounds invalid counts, spacing, options, reservations, dates and time-zone inputs', () => {
    for (const patch of [
      { count: 0 }, { count: 101 }, { count: 1.5 }, { spacingMinutes: 0 }, { spacingMinutes: 1441 }, { spacingMinutes: NaN }, { spacingMinutes: 1.5 },
      { timeZone: 'Not/AZone' }, { timeZone: '' }, { sendAt: '2026-02-30T14:00:00.000Z' }, { sendAt: '2026-11-09T09:00:00-05:00' },
      { businessHours: 'true' }, { spreadAcrossDays: 1 }, { reserved: new Array(501).fill(reserved(base.sendAt)) },
      { reserved: [{ sendAt: base.sendAt, active: 1, countsTowardDailyLimit: true }] },
      { reserved: [reserved('invalid')] },
    ]) expect(() => planSendTimes({ ...base, ...patch } as SendPlanInput)).toThrow();
  });

  it('rejects a one-minute interval that exceeds the connected sender cadence', () => {
    expect(() => planSendTimes({ ...base, spacingMinutes: 1 })).toThrow('Space messages by 2 to 1,440 minutes.');
  });
});
