import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { AutomaticDelivery, AutomaticDeliveryState, AutomationPage } from '../shared/automation';
import type { OutreachItem } from '../shared/outreach';
import type { MailboxSignalsStatus } from '../server/mailbox-signals';
import { scheduleIso } from './outreach-import';
import { allowedTestRecipients, messageSnapshot } from './automation-selection';
import { planSendTimes } from '../shared/send-plan';

export type AutomationAction = <T>(name: string, operation: () => Promise<T>, success: string) => Promise<T | null>;
type Pick = { id: string; version: number };
type Plan = { items: Pick[]; sendAt: string; timeZone: string; spacingMinutes: number; businessHours: boolean; spreadAcrossDays: boolean; expectedSendTimes: string[]; reservedSnapshot: string; sender: string; testRecipient: string | null; snapshot: string };

export const automaticStateNames: Record<AutomaticDeliveryState, string> = {
  pending: 'Scheduled to send', submitting: 'Submission in progress', accepted: 'Microsoft accepted',
  sent: 'Sent copy confirmed', cancelled: 'Cancelled', blocked: 'Sending held', needs_attention: 'Needs review',
};
const time = (value: string | null, zone?: string) => value
  ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium', ...(zone ? { timeZone: zone } : {}) }).format(new Date(value)) : '—';
const localTime = (value = new Date(Date.now() + 5 * 60_000).toISOString()) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};


async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, cache: 'no-store', headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json() as { data?: T; error?: { message?: string } };
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message ?? 'Automatic sending could not be updated. Refresh and check its saved state.');
  return payload.data;
}

export default function AutomationPanel({ items, picks, disabled, active, onAction, onScheduled }: {
  items: OutreachItem[]; picks: Pick[]; disabled: boolean; active: boolean;
  onAction: AutomationAction; onScheduled: () => void;
}) {
  const [page, setPage] = useState<AutomationPage | null>(null);
  const [signals, setSignals] = useState<MailboxSignalsStatus | null>(null);
  const [statusAvailable, setStatusAvailable] = useState(false);
  const [error, setError] = useState('');
  const [sendTime, setSendTime] = useState(localTime);
  const [spacing, setSpacing] = useState(5);
  const [businessHours, setBusinessHours] = useState(true);
  const [spreadAcrossDays, setSpreadAcrossDays] = useState(true);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [allowSend, setAllowSend] = useState(false);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const [allowPermissions, setAllowPermissions] = useState(false);
  const [disconnectOpen, setDisconnectOpen] = useState(false);
  const [resumeOpen, setResumeOpen] = useState(false);
  const [deliverySearch, setDeliverySearch] = useState('');
  const [deliveryLimit, setDeliveryLimit] = useState(10);
  const [expanded, setExpanded] = useState(false);
  const approvedSelection = picks.map(pick => `${pick.id}:${pick.version}`).join('|');
  useEffect(() => { if (approvedSelection) setExpanded(true); }, [approvedSelection]);
  const [reschedule, setReschedule] = useState<{ id: string; version: number; sendTime: string } | null>(null);
  const generation = useRef(0);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const refresh = useCallback(async () => {
    const requestId = ++generation.current;
    try {
      const [result, mailboxSignals] = await Promise.all([request<AutomationPage>('/api/automation'), request<MailboxSignalsStatus>('/api/automation/signals')]);
      if (requestId === generation.current) { setPage(result); setSignals(mailboxSignals); setStatusAvailable(true); setError(''); }
    } catch (failure) {
      if (requestId === generation.current) setStatusAvailable(false);
      throw failure;
    }
  }, []);
  useEffect(() => {
    if (!active || disabled) return;
    let mounted = true;
    const update = () => { void refresh().catch(failure => { if (mounted) setError((failure as Error).message); }); };
    update();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') update(); }, 15_000);
    return () => { mounted = false; generation.current += 1; window.clearInterval(timer); };
  }, [active, disabled, refresh]);
  const selected = picks.map(pick => items.find(item => item.id === pick.id && item.version === pick.version))
    .filter((item): item is OutreachItem => !!item && item.state === 'approved' && !item.doNotContact && !item.automaticDelivery);
  const currentFingerprint = messageSnapshot(selected);
  const sender = page?.mailbox.connectedEmail ?? page?.mailbox.ownerEmail ?? '';
  const testRecipient = page?.testRecipient ?? null;
  const testSelectionAllowed = allowedTestRecipients(selected, testRecipient);
  const reserved = (page?.deliveries ?? []).map(delivery => ({ sendAt: delivery.sendAt, active: ['pending', 'submitting'].includes(delivery.state), countsTowardDailyLimit: ['pending', 'submitting', 'accepted', 'sent'].includes(delivery.state) || delivery.attempts === 1 }));
  const reservedSnapshot = JSON.stringify(reserved);
  const matchingDeliveries = (page?.deliveries ?? []).filter(delivery => `${delivery.label} ${delivery.recipient} ${delivery.subject}`.toLowerCase().includes(deliverySearch.trim().toLowerCase()));
  const ready = statusAvailable && !!page?.mailbox.connected && page.mailbox.sendingEnabled;
  const planCurrent = useMemo(() => !!plan && plan.snapshot === currentFingerprint && plan.items.length === selected.length
    && plan.sender === sender && plan.testRecipient === testRecipient && testSelectionAllowed
    && plan.businessHours === businessHours && plan.spreadAcrossDays === spreadAcrossDays && plan.reservedSnapshot === reservedSnapshot
    && plan.items.every((pick, index) => selected[index]?.id === pick.id && selected[index]?.version === pick.version), [plan, currentFingerprint, selected, sender, testRecipient, testSelectionAllowed, businessHours, spreadAcrossDays, reservedSnapshot]);
  useEffect(() => { setAllowSend(false); }, [plan, currentFingerprint, ready, sender, testRecipient, businessHours, spreadAcrossDays, reservedSnapshot, page?.paused]);
  useEffect(() => { if (!page?.paused) setResumeOpen(false); }, [page?.paused]);
  async function perform<T>(name: string, operation: () => Promise<T>, success: string) {
    return onAction(`automation:${name}`, async () => {
      const result = await operation();
      await refresh();
      return result;
    }, success);
  }
  function reviewPlan(event: FormEvent) {
    event.preventDefault();
    try {
      if (!ready || !selected.length || selected.length !== picks.length) throw new Error('Select current approved messages without an existing send plan.');
      if (!testSelectionAllowed) throw new Error('Test mode allows only the displayed test recipient. Change the selected messages before continuing.');
      if (new Set(selected.map(item => item.recipient.trim().toLowerCase())).size !== selected.length) throw new Error('Choose one approved message per recipient in this send schedule.');
      if (!Number.isInteger(spacing) || spacing < (page?.policy.minimumSpacingMinutes ?? 2) || spacing > 1440) throw new Error('Choose a whole number of minutes between 2 and 1,440.');
      const sendAt = scheduleIso(sendTime);
      const expectedSendTimes = planSendTimes({ sendAt, timeZone, spacingMinutes: spacing, count: selected.length, businessHours, spreadAcrossDays, reserved });
      if (Date.parse(expectedSendTimes[0]!) <= Date.now() || Date.parse(expectedSendTimes.at(-1)!) > Date.now() + 30 * 86400000) throw new Error('Choose a schedule whose complete set of send times is in the next 30 days.');
      setPlan({ items: selected.map(({ id, version }) => ({ id, version })), sendAt, timeZone, spacingMinutes: spacing, businessHours, spreadAcrossDays, expectedSendTimes, reservedSnapshot, sender, testRecipient, snapshot: currentFingerprint });
      setAllowSend(false); setError('');
    } catch (failure) { setError((failure as Error).message); }
  }
  async function schedule() {
    if (!plan || !planCurrent || !allowSend || !ready || disabled) return;
    const payload = { items: plan.items, sendAt: plan.sendAt, timeZone: plan.timeZone, spacingMinutes: plan.spacingMinutes, businessHours: plan.businessHours, spreadAcrossDays: plan.spreadAcrossDays, expectedSendTimes: plan.expectedSendTimes };
    const saved = await perform('schedule', () => request('/api/automation/schedule', 'POST', { ...payload, confirmSending: true }), 'Automatic sending saved for these approved versions. Check the saved schedule below.');
    if (saved) { setPlan(null); setAllowSend(false); onScheduled(); }
  }
  async function connect() {
    if (!allowPermissions || disabled) return;
    const result = await perform('connect', () => request<{ authorizeUrl: string }>('/api/mailbox/connect', 'POST', { acknowledgePermissions: true }), 'Microsoft sign-in prepared.');
    if (result) {
      try {
        const destination = new URL(result.authorizeUrl);
        if (destination.origin !== 'https://login.microsoftonline.com' || destination.username || destination.password) throw new Error();
        window.location.assign(destination.href);
      } catch { setError('Microsoft returned an unexpected sign-in address. Connection was not opened.'); }
    }
  }
  async function changeDelivery(delivery: AutomaticDelivery, verb: 'cancel' | 'reschedule') {
    if (verb === 'reschedule' && (!reschedule || reschedule.id !== delivery.id || reschedule.version !== delivery.version)) return;
    let body: { version: number; sendAt?: string; timeZone?: string } = { version: delivery.version };
    try { if (verb === 'reschedule') body = { ...body, sendAt: scheduleIso(reschedule!.sendTime), timeZone }; }
    catch (failure) { setError((failure as Error).message); return; }
    const result = await perform(`${verb}:${delivery.id}`, () => request(`/api/automation/${delivery.id}/${verb}`, 'POST', body), verb === 'reschedule'
      ? 'Send time updated. Maildesk also updated its tracking plan.'
      : 'Stop request saved. An in-flight or accepted message cannot be recalled; its actual outcome remains visible.');
    if (result) setReschedule(null);
  }
  return <section className={`automation-panel${expanded ? '' : ' automation-panel-collapsed'}`} aria-label="Automatic sending">
    <details className="automation-disclosure" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary><strong>Automatic sending</strong><span className={`automation-badge ${ready && !page?.paused && !signals?.checking && !signals?.lastError ? 'automation-ready' : ''}`}>{!statusAvailable && error ? 'Status unavailable' : !page ? 'Checking setup' : !page.mailbox.configured ? 'Setup needed' : !page.mailbox.connected ? 'Connect Outlook' : !page.mailbox.sendingEnabled ? 'Sending disabled' : page.paused ? 'Paused' : signals?.lastError ? 'Sending held' : signals?.checking ? 'Checking mailbox' : 'Ready to schedule'}</span><span className="automation-summary-hint">Setup, pause controls, saved plans and sending status{picks.length ? ` · ${picks.length} approved selected` : ''}</span></summary>
      <div className="automation-disclosure-body"><p>Maildesk adds the logo and opt-out, checks do-not-contact, and submits only the versions you approve.</p>
    {error && <div className="outreach-notice outreach-warning" role="alert"><p>{error}</p><button className="text-button" disabled={disabled} onClick={() => void refresh().catch(failure => setError((failure as Error).message))}>Refresh sending status</button></div>}
    {page && <>
      {testRecipient && <div className="outreach-notice outreach-warning" role="status"><strong>Test mode · sends limited to {testRecipient}</strong><p>Only approved messages addressed to this recipient can be scheduled or submitted. Other recipients remain blocked from automatic sending.</p></div>}
      <div className="automation-connection">
        <div><strong>{page.mailbox.connected ? `Connected to ${page.mailbox.connectedEmail ?? page.mailbox.ownerEmail}` : 'Connect your Solure Microsoft mailbox once'}</strong>
          <p>{!page.mailbox.configured ? 'The secure Microsoft connection needs administrator setup before it can be connected. You can keep preparing and reviewing drafts now.' : !page.mailbox.connected ? 'Sign in with your Solure owner account. Scheduled work then runs on the server, with your browser closed.' : !page.mailbox.sendingEnabled ? 'The connection is saved, but this installation’s sending switch is off. No scheduled email will be submitted until it is enabled.' : page.paused ? 'Scheduled submissions are paused. You can review or cancel them before resuming.' : 'No per-message copying is needed for emails scheduled here.'}</p>
          {page.mailbox.lastError && <p className="field-error">{page.mailbox.lastError}</p>}
        </div>
        <div className="automation-actions">
          {!page.mailbox.connected && <button className="button secondary" disabled={disabled || !page.mailbox.configured} onClick={() => { setPermissionsOpen(!permissionsOpen); setAllowPermissions(false); }}>{permissionsOpen ? 'Close connection details' : 'Connect Microsoft'}</button>}
          {(page.mailbox.connected || page.deliveries.some(delivery => delivery.state === 'pending')) && <button className="button secondary" disabled={disabled || (page.paused && (!page.mailbox.connected || !page.mailbox.sendingEnabled))} onClick={() => { if (page.paused) setResumeOpen(!resumeOpen); else void perform('pause', () => request('/api/automation/pause', 'POST', { paused: true }), 'Scheduled sending paused. Requests already submitted cannot be recalled.'); }}>{page.paused ? 'Resume scheduled sending' : 'Pause scheduled sending'}</button>}
          {page.mailbox.connected && <button className="text-button" disabled={disabled} onClick={() => setDisconnectOpen(!disconnectOpen)}>Disconnect</button>}
        </div>
      </div>
      {resumeOpen && page.paused && <div className="automation-permissions" role="region" aria-label="Confirm resuming scheduled sending"><h3>Resume previously authorized sends?</h3><p>After the mailbox checks pass, emails already due by no more than {page.policy.maxLatenessMinutes} minutes may be submitted immediately. Older plans are held for review. Check the saved plans below before continuing.</p><div className="automation-actions"><button className="button primary" disabled={disabled || !ready} onClick={() => void perform('resume', () => request('/api/automation/pause', 'POST', { paused: false }), 'Scheduled sending resumed. Due approved messages can now be submitted after mailbox checks.').then(result => { if (result) setResumeOpen(false); })}>Confirm resume</button><button className="text-button" disabled={disabled} onClick={() => setResumeOpen(false)}>Keep paused</button></div></div>}
      {!page.mailbox.configured && <ol className="automation-setup-list"><li>Register the owner-only Microsoft connection.</li><li>Store its credentials securely on the server.</li><li>Connect, verify a controlled test, and enable sending.</li></ol>}
      {permissionsOpen && !page.mailbox.connected && <div className="automation-permissions" role="region" aria-label="Review Microsoft permissions"><h3>Review the access before connecting</h3><p>This connects only the configured owner’s mailbox. Microsoft will ask for permission to read mail, send mail as you, read your account identity, and keep access for scheduled work.</p><p>Reading permission covers the connected mailbox, not just Maildesk messages. This connection does not request permission to edit or delete your existing Outlook mail. Connecting does not approve any email for sending.</p>{page.deliveries.some(delivery => delivery.state === 'pending') && <p className="automation-reconnect-note">{page.paused ? 'Your saved send plans are paused. Reconnecting keeps that pause in place until you choose Resume scheduled sending.' : 'Reconnecting can resume previously authorized send plans. Review or pause those plans before continuing.'}</p>}<label className="automation-check"><input type="checkbox" checked={allowPermissions} disabled={disabled} onChange={event => setAllowPermissions(event.target.checked)} /><span>I understand this mailbox access and want to continue to Microsoft’s consent screen.</span></label><div className="automation-actions"><button className="button primary" disabled={disabled || !allowPermissions} onClick={() => void connect()}>Continue to Microsoft</button><button className="text-button" disabled={disabled} onClick={() => setPermissionsOpen(false)}>Back</button></div></div>}
      {disconnectOpen && page.mailbox.connected && <div className="automation-permissions" role="region" aria-label="Confirm Microsoft disconnect"><h3>Disconnect this mailbox?</h3><p>Maildesk removes its saved connection. Pending work will stop until you reconnect. Messages already submitted to Microsoft cannot be recalled.</p><div className="automation-actions"><button className="button secondary" disabled={disabled} onClick={() => void perform('disconnect', () => request('/api/mailbox/disconnect', 'POST', {}), 'Microsoft disconnected. Pending emails are not being submitted.').then(result => { if (result) setDisconnectOpen(false); })}>Disconnect Microsoft</button><button className="text-button" disabled={disabled} onClick={() => setDisconnectOpen(false)}>Keep connected</button></div></div>}
      {page.paused && <div className="outreach-notice outreach-warning" role="status"><strong>Scheduled sending is paused.</strong><p>You can safely plan or change send times. New plans stay queued and will not be submitted until you resume.</p></div>}
      <form className="automation-schedule" onSubmit={reviewPlan}>
        <div><h3>Schedule the selected approved messages</h3><p>Select messages in the review queue below. The final confirmation authorizes sending, separately from approving their wording.</p></div>
        <div className="automation-fields"><label>Start no earlier than<input type="datetime-local" required value={sendTime} disabled={disabled || !ready} onChange={event => { setSendTime(event.target.value); setPlan(null); }} /><span>{timeZone}</span></label><label>Minutes between emails<input type="number" required min={page.policy.minimumSpacingMinutes} max={1440} step={1} value={spacing} disabled={disabled || !ready} onChange={event => { setSpacing(Number(event.target.value)); setPlan(null); }} /></label><div><strong>{selected.length} approved {selected.length === 1 ? 'version' : 'versions'} selected</strong><button className="button primary" disabled={disabled || !ready || !testSelectionAllowed || !selected.length || selected.length !== picks.length} type="submit">Review send schedule</button></div></div>
        <div className="automation-planning-options"><label className="automation-check"><input type="checkbox" checked={businessHours} disabled={disabled || !ready} onChange={event => { setBusinessHours(event.target.checked); setPlan(null); }} /><span>Use weekdays, 9 a.m.–5 p.m. in {timeZone}.</span></label><label className="automation-check"><input type="checkbox" checked={spreadAcrossDays} disabled={disabled || !ready} onChange={event => { setSpreadAcrossDays(event.target.checked); setPlan(null); }} /><span>Spread the batch over more days when a day is full or a saved send is too close.</span></label></div><p className="outreach-small">We use the next eligible time at or after your starting point. The exact dates appear for your review before you authorize sending.</p>
        {!testSelectionAllowed && <p className="field-error" role="status">Select only the controlled test recipient shown above to continue.</p>}
        <p className="outreach-small">Up to {page.policy.dailyLimit} submissions per UTC day · at least {page.policy.minimumSpacingMinutes} minutes between emails. Schedules are checked on the server every two minutes; exact-second sending is not guaranteed.</p>
      </form>
      {plan && <div className="automation-confirmation" role="region" aria-label="Authorize automatic sending"><h3>Review and authorize this send schedule</h3><p>Maildesk will submit these exact approved versions from {plan.sender}. They do not need a second schedule in Outlook.</p>{page.paused && <p><strong>This plan will be queued while sending is paused.</strong> Resume scheduled sending when you are ready for previously authorized messages to be submitted.</p>}<ol className="automation-plan-list">{plan.items.map((pick, index) => { const item = items.find(value => value.id === pick.id); const at = plan.expectedSendTimes[index]!; return <li key={pick.id}><strong>{item?.label ?? 'Message unavailable'} · version {pick.version}</strong><span>{item?.recipient ?? 'Recipient unavailable'}</span><span>{item?.subject ?? 'Subject unavailable'}</span><time>{time(at, plan.timeZone)} · {plan.timeZone}</time><small>Tracking no earlier than {time(new Date(Date.parse(at) + page.policy.trackingDelaySeconds * 1000).toISOString(), plan.timeZone)}, after Microsoft accepts the request.</small></li>; })}</ol>
        {!planCurrent && <p className="field-error" role="alert">The selection, mailbox, test mode or saved send plans changed. Review the schedule again before authorizing it.</p>}
        <label className="automation-check"><input type="checkbox" checked={allowSend} disabled={disabled || !ready || !planCurrent} onChange={event => setAllowSend(event.target.checked)} /><span>I authorize Maildesk to send these approved messages at the times shown.</span></label><div className="automation-actions"><button className="button primary" disabled={disabled || !ready || !planCurrent || !allowSend} onClick={() => void schedule()}>Authorize and schedule sending</button><button className="text-button" disabled={disabled} onClick={() => { setPlan(null); setAllowSend(false); }}>Back to review</button></div>
      </div>}
      {signals && <section className="automation-monitoring" aria-label="Reply and delivery monitoring"><div className="automation-delivery-heading"><div><h3>Replies and delivery failures</h3><p>{!page.mailbox.connected ? 'Connect the mailbox to enable automatic checks.' : signals.lastError ? 'Sending is held until the mailbox check is resolved.' : signals.checking ? 'Checking earlier messages before sending.' : signals.lastCheckedAt ? `Last checked ${time(signals.lastCheckedAt)}.` : 'Waiting for the first mailbox check before sending.'}</p></div><span className="automation-badge">{signals.lastError ? 'Needs review' : signals.checking ? 'Checking' : signals.lastCheckedAt ? 'Checked' : 'Not checked'}</span></div>{signals.lastError && <p className="field-error" role="status">{signals.lastError}</p>}<p>Precisely matched replies and delivery failures pause further outreach for that recipient. A review hold is separate from an explicit do-not-contact request. Maildesk checks across mailbox folders and does not send automatic replies.</p>{signals.holds.length > 0 && <details className="automation-holds"><summary>Recipients on hold · {signals.holds.length}</summary><ul>{signals.holds.slice(0, 30).map(hold => <li key={`${hold.recipient}:${hold.kind}:${hold.createdAt}`}><strong>{hold.recipient}</strong><span>{hold.kind === 'reply' ? 'Reply received' : hold.kind === 'bounce' ? 'Delivery failure' : 'Needs review'} · {time(hold.createdAt)}</span><p>{hold.message}</p></li>)}</ul>{signals.holds.length > 30 && <p className="outreach-small">Showing the 30 most recent holds.</p>}</details>}{!!signals.notices?.length && <details className="automation-notices"><summary>Unmatched incoming reports · {signals.notices.length}</summary><p>These reports could not be linked to a Maildesk message. Check the original report in Outlook; this advisory does not confirm a delivery failure or place a recipient on hold.</p><ul>{signals.notices.slice(0, 5).map((notice, index) => <li key={`${notice.createdAt}:${index}`}><time dateTime={notice.createdAt}>Noted {time(notice.createdAt)}</time><span>{notice.message}</span></li>)}</ul>{signals.notices.length > 5 && <p className="outreach-small">Showing the five most recent notices.</p>}</details>}</section>}
      {page.deliveries.length > 0 && <details className="automation-history"><summary>Saved send plans <span>{page.deliveries.length}</span></summary><label className="automation-delivery-search">Find a saved send plan<input type="search" maxLength={254} value={deliverySearch} onChange={event => { setDeliverySearch(event.target.value); setDeliveryLimit(10); }} placeholder="Business, recipient or subject" /></label><div className="automation-deliveries">{matchingDeliveries.slice(0, deliveryLimit).map(delivery => <article key={delivery.id} className="automation-delivery"><div className="automation-delivery-heading"><div><strong>{delivery.label}</strong><span>{delivery.recipient}</span><span>{delivery.subject}</span></div><span className={`automation-badge automation-state-${delivery.state}`}>{automaticStateNames[delivery.state]}</span></div><p>{time(delivery.sendAt, delivery.timeZone)} · {delivery.timeZone} · approved version {delivery.approvedVersion}</p>
        {delivery.acceptedAt && <p className="outreach-small">Microsoft accepted the request at {time(delivery.acceptedAt)}. This does not prove delivery or Inbox placement.</p>}
        {delivery.sentAt && <p className="outreach-small">A sent copy was observed at {time(delivery.sentAt)}.</p>}
        {delivery.cancelRequested && <p className="outreach-small">{['accepted', 'sent'].includes(delivery.state) ? 'Tracking is stopped. The email was already submitted and cannot be recalled.' : delivery.state === 'cancelled' ? 'Cancelled before submission.' : 'Stop requested. A submission already in progress may still be accepted.'}</p>}
        {delivery.lastError && <p className="field-error">{delivery.lastError}</p>}
        {['pending', 'submitting', 'accepted', 'sent', 'needs_attention'].includes(delivery.state) && !delivery.cancelRequested && <div className="automation-actions"><button className="text-button" disabled={disabled} onClick={() => void changeDelivery(delivery, 'cancel')}>{['accepted', 'sent'].includes(delivery.state) ? 'Stop tracking' : delivery.state === 'submitting' || (delivery.state === 'needs_attention' && delivery.attempts > 0) ? 'Request stop' : 'Cancel send'}</button>{(delivery.state === 'pending' || (delivery.state === 'needs_attention' && delivery.attempts === 0 && !delivery.submittedAt)) && <button className="text-button" disabled={disabled || !ready} onClick={() => setReschedule({ id: delivery.id, version: delivery.version, sendTime: localTime(delivery.sendAt) })}>Change send time</button>}</div>}
        {reschedule?.id === delivery.id && !delivery.cancelRequested && (delivery.state === 'pending' || (delivery.state === 'needs_attention' && delivery.attempts === 0 && !delivery.submittedAt)) && <form className="automation-reschedule" onSubmit={event => { event.preventDefault(); void changeDelivery(delivery, 'reschedule'); }}><label>New send time<input type="datetime-local" required value={reschedule.sendTime} disabled={disabled || !ready} onChange={event => setReschedule({ ...reschedule, sendTime: event.target.value })} /><span>{timeZone}</span></label>{reschedule.version !== delivery.version && <p className="field-error">This plan changed. Close this form and review its current state.</p>}<div className="automation-actions"><button className="button secondary" disabled={disabled || !ready || reschedule.version !== delivery.version}>Save send time</button><button type="button" className="text-button" disabled={disabled} onClick={() => setReschedule(null)}>Keep current time</button></div></form>}
      </article>)}</div><p className="outreach-small">{Math.min(deliveryLimit, matchingDeliveries.length)} of {matchingDeliveries.length} matching send plans</p>{matchingDeliveries.length > deliveryLimit && <button className="text-button" onClick={() => setDeliveryLimit(value => value + 10)}>Show 10 more</button>}</details>}
      {page.activity.length > 0 && <details className="automation-history"><summary>Recent sending activity</summary><ol className="automation-activity">{page.activity.slice(0, 30).map(entry => <li key={entry.id}><time>{time(entry.createdAt)}</time><span>{entry.message}</span></li>)}</ol></details>}
      <details className="automation-limits"><summary>What this automation does and does not verify</summary><p>The footer and message-specific tracking image are added automatically. Gmail’s native Unsubscribe control still requires verification of the received email’s signed headers.</p><p>Accepted means Microsoft received a send request. A sent copy, delivery, Inbox placement and a human reading are separate observations. An uncertain send is held for review instead of automatically submitting it again.</p><p>Pausing or cancelling cannot recall a request already in progress. Mailbox checks can pause later outreach when a reply or failure is matched. They do not prove successful delivery or human reading.</p></details>
    </>}
      </div>
    </details>
  </section>;
}
