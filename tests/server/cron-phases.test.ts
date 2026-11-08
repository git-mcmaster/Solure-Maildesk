import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/server/types';

const work = vi.hoisted(() => ({ signals: vi.fn(), sending: vi.fn(), reports: vi.fn(), reportSend: vi.fn(), retention: vi.fn(), alerts: vi.fn() }));
vi.mock('../../src/server/mailbox-signals', async original => ({ ...await original<object>(), runMailboxSignals: work.signals }));
vi.mock('../../src/server/automation', async original => ({ ...await original<object>(), runAutomation: work.sending }));
vi.mock('../../src/server/reports', async original => ({ ...await original<object>(), queuePixelReports: work.reports, dispatchPixelReports: work.reportSend }));
vi.mock('../../src/server/notifications', async original => ({ ...await original<object>(), enforceRetention: work.retention, dispatchNotifications: work.alerts }));
import { runScheduled } from '../../src/server/dashboard';

const enabled = { OUTREACH_SENDING_ENABLED: 'true' } as Env;
const even = new Date('2026-11-08T17:00:00.000Z');
const odd = new Date('2026-11-08T17:01:00.000Z');
beforeEach(() => { vi.clearAllMocks(); work.signals.mockResolvedValue(true); });

describe('separate free-plan cron workloads', () => {
  it('preserves every-minute legacy processing when automatic sending is disabled', async () => {
    await runScheduled({} as Env, odd);
    expect(work.reports).toHaveBeenCalledOnce(); expect(work.reportSend).toHaveBeenCalledOnce();
    expect(work.retention).toHaveBeenCalledOnce(); expect(work.alerts).toHaveBeenCalledOnce();
    expect(work.signals).not.toHaveBeenCalled(); expect(work.sending).not.toHaveBeenCalled();
  });
  it('runs legacy work alone on even minutes and connected work alone on odd minutes', async () => {
    await runScheduled(enabled, even);
    expect(work.reports).toHaveBeenCalledOnce(); expect(work.signals).not.toHaveBeenCalled();
    await runScheduled(enabled, odd);
    expect(work.reports).toHaveBeenCalledOnce(); expect(work.reportSend).toHaveBeenCalledOnce();
    expect(work.retention).toHaveBeenCalledOnce(); expect(work.alerts).toHaveBeenCalledOnce();
    expect(work.signals).toHaveBeenCalledWith(enabled, odd); expect(work.sending).toHaveBeenCalledWith(enabled, odd);
  });
  it('holds dispatch after an incomplete mailbox check without starving the next legacy phase', async () => {
    work.signals.mockResolvedValue(false);
    await runScheduled(enabled, odd); expect(work.sending).not.toHaveBeenCalled();
    await runScheduled(enabled, new Date(odd.getTime() + 60_000));
    expect(work.reports).toHaveBeenCalledOnce(); expect(work.alerts).toHaveBeenCalledOnce();
  });
});
