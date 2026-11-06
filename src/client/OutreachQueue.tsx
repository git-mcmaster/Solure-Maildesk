import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { DEFAULT_TRACKING_DELAY_SECONDS, type OutreachInput, type OutreachItem, type OutreachPage, type OutreachState } from '../shared/outreach';
import { MAX_IMPORT_BYTES, parseOutreachImport, scheduleIso } from './outreach-import';

const stateNames: Record<OutreachState, string> = {
  draft: 'Draft', prepared: 'Ready to review', approved: 'Approved', scheduled: 'Scheduled',
  tracking: 'Tracking active', cancelled: 'Cancelled', blocked: 'Do not contact', needs_attention: 'Needs attention',
};
const editableStates = new Set<OutreachState>(['draft', 'prepared', 'approved', 'cancelled', 'blocked']);
const cancellableStates = new Set<OutreachState>(['draft', 'prepared', 'approved', 'scheduled', 'tracking']);
const time = (value: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value)) : '—';
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

async function request<T>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method, signal, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json() as { data?: T; error?: { message?: string } };
  if (!response.ok || payload.data === undefined) throw new Error(payload.error?.message ?? 'The review queue could not be updated. Refresh and try again.');
  return payload.data;
}

function localTimeAhead(): string {
  const now = new Date(Date.now() + 5 * 60_000);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function localDateTime(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function fields(item: OutreachItem): OutreachInput {
  return { label: item.label, recipient: item.recipient, subject: item.subject, body: item.body };
}

function DraftReview({ item, disabled, ownerEmail, pixelBaseUrl, discardRevision, onDirtyChange, onSave, onPrepare, onApprove, onCancel, onReschedule }: {
  item: OutreachItem; disabled: boolean; ownerEmail: string; pixelBaseUrl: string;
  discardRevision: number; onDirtyChange: (dirty: boolean) => void;
  onSave: (item: OutreachItem, values: OutreachInput) => Promise<OutreachItem | null>;
  onPrepare: (item: OutreachItem) => Promise<unknown>;
  onApprove: (item: OutreachItem) => Promise<unknown>;
  onCancel: (item: OutreachItem) => Promise<unknown>;
  onReschedule: (item: OutreachItem, sendAt: string) => Promise<unknown>;
}) {
  const [baseline, setBaseline] = useState(item);
  const [values, setValues] = useState(() => fields(item));
  const [copyNotice, setCopyNotice] = useState('');
  const [rescheduleTime, setRescheduleTime] = useState(() => item.scheduledAt ? localDateTime(item.scheduledAt) : localTimeAhead());
  const dirty = JSON.stringify(values) !== JSON.stringify(fields(baseline));
  const stale = item.version !== baseline.version;
  const lastDiscardRevision = useRef(discardRevision);
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => {
    if (lastDiscardRevision.current !== discardRevision) {
      lastDiscardRevision.current = discardRevision;
      setBaseline(item); setValues(fields(item)); onDirtyChange(false);
    }
  }, [discardRevision, item, onDirtyChange]);
  useEffect(() => {
    if (!dirty && item.version !== baseline.version) { setBaseline(item); setValues(fields(item)); }
  }, [item, baseline.version, dirty]);
  const editable = editableStates.has(item.state) && item.canEdit;
  async function save(event: FormEvent) {
    event.preventDefault();
    const saved = await onSave(baseline, values);
    if (saved) { setBaseline(saved); setValues(fields(saved)); }
  }
  async function copyPrepared(asHtmlSource = false) {
    if (dirty || stale || item.doNotContact || !item.preparedHtml || !item.preparedText || !['approved', 'scheduled', 'tracking'].includes(item.state)) return;
    setCopyNotice('');
    try {
      if (asHtmlSource) {
        await navigator.clipboard.writeText(item.preparedHtml);
        setCopyNotice('HTML source copied. Use an email editor that inserts HTML; pasting this source as plain text does not create a tracking image.');
      } else {
        if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Rich-text copying is unavailable in this browser. Use Copy HTML source with a compatible email editor.');
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([item.preparedHtml], { type: 'text/html' }), 'text/plain': new Blob([item.preparedText], { type: 'text/plain' }) })]);
        setCopyNotice('Complete message copied. Paste into Outlook, set its recipient and subject, and schedule it there. Check that the logo and opt-out footer remain in the draft.');
      }
    } catch (failure) { setCopyNotice(failure instanceof Error ? failure.message : 'Copying failed. Try again from this page.'); }
  }
  return <section className="outreach-review" aria-label="Selected draft">
    <div className="outreach-section-head">
      <div><div className="eyebrow">REVIEW ONE MESSAGE</div><h2>{item.label}</h2></div>
      <span className={`outreach-status outreach-status-${item.state}`}>{stateNames[item.state]}</span>
    </div>
    {item.doNotContact && <div className="outreach-notice outreach-danger" role="status"><strong>This recipient is on your do-not-contact list.</strong><p>Preparation, approval, scheduling and new tracking are blocked for this address.</p></div>}
    {item.lastError && <p className="field-error" role="status">{item.lastError}</p>}
    {!item.canEdit && ['cancelled', 'blocked'].includes(item.state) && <p className="outreach-small">This message’s saved history is kept. Import a new draft to prepare a separate message; this historical version cannot be edited or prepared again.</p>}
    {stale && dirty && <div className="outreach-notice outreach-warning" role="alert"><p>The saved version changed while you were editing. Your text is still here; compare it before saving.</p><button className="text-button" onClick={() => { setBaseline(item); setValues(fields(item)); }}>Reload saved version</button></div>}
    <form className="outreach-editor" onSubmit={(event) => void save(event)}>
      <label>Message label<input required maxLength={150} value={values.label} disabled={!editable || disabled} onChange={(event) => setValues({ ...values, label: event.target.value })} /></label>
      <label>Recipient<input type="email" required maxLength={254} value={values.recipient} disabled={!editable || disabled} onChange={(event) => setValues({ ...values, recipient: event.target.value })} /></label>
      <label>Subject<input required maxLength={200} value={values.subject} disabled={!editable || disabled} onChange={(event) => setValues({ ...values, subject: event.target.value })} /></label>
      <label>Message body<textarea required maxLength={10_000} rows={10} value={values.body} disabled={!editable || disabled} onChange={(event) => setValues({ ...values, body: event.target.value })} /></label>
      {editable && <div className="outreach-editor-actions"><button type="submit" className="button secondary" disabled={disabled || !dirty || stale}>Save changes</button>{dirty && <button type="button" className="text-button" disabled={disabled} onClick={() => { setBaseline(item); setValues(fields(item)); onDirtyChange(false); }}>Discard changes</button>}<p>Changes require fresh preparation and approval.</p></div>}
    </form>
    {item.preparedText && !dirty ? <section className="outreach-preview" aria-label="Prepared message preview">
      <div className="outreach-preview-head"><strong>Prepared version {item.version}</strong><span>Plain-text review · no tracking requests</span></div>
      <p className="outreach-preview-address">To: {item.recipient}<br />Subject: {item.subject}</p>
      <pre>{item.preparedText}</pre>
      <div className="outreach-signature-preview"><img src={new URL('/brand/solure-logo-v1.png', pixelBaseUrl).href} width="48" height="50" alt="Solure logo preview" /><div><strong>Elijah McMaster</strong><span>Solure Digital Works</span><span>{ownerEmail}</span></div></div>
      <p className="outreach-small">The outgoing HTML uses one unique tracking logo and this recipient’s opt-out link. This preview uses an untracked logo.</p>
      {item.state === 'tracking' && <p className="outreach-small">Tracking is already active. Pasting or previewing the copied message in Outlook can load its logo and count as activity.</p>}
      {item.optOutUrl && <label>Recipient-bound opt-out address<input value={item.optOutUrl} readOnly aria-label="Prepared opt-out address" /></label>}
    </section> : <div className="outreach-notice"><p>{dirty ? 'Save your changes before preparing or approving this message.' : 'Prepare this draft to add its unique logo and opt-out footer. Then review the complete version before approval.'}</p></div>}
    <div className="outreach-review-actions">
      {editable && <button className="button secondary" disabled={disabled || dirty || stale || item.doNotContact || item.state === 'prepared' || item.state === 'approved'} onClick={() => void onPrepare(item)}>Prepare logo &amp; opt-out</button>}
      {item.state === 'prepared' && <button className="button primary" disabled={disabled || dirty || stale || item.doNotContact} onClick={() => void onApprove(item)}>Approve version {item.version}</button>}
      {cancellableStates.has(item.state) && <button className="text-button" disabled={disabled || dirty} onClick={() => void onCancel(item)}>{item.state === 'tracking' ? 'Stop tracking' : item.state === 'scheduled' ? 'Cancel tracking schedule' : 'Cancel this item'}</button>}
    </div>
    {['approved', 'scheduled', 'tracking'].includes(item.state) && <section className="outreach-copy"><h3>Put this approved message in Outlook</h3><p className="outreach-small">Copy version {item.version}, paste its body in Outlook, then set the recipient and subject shown above. Maildesk does not send the email.</p><div className="outreach-review-actions"><button className="button primary" disabled={disabled || dirty || stale || item.doNotContact} onClick={() => void copyPrepared()}>Copy complete message for Outlook</button><button className="text-button" disabled={disabled || dirty || stale || item.doNotContact} onClick={() => void copyPrepared(true)}>Copy HTML source</button></div>{copyNotice && <p className="outreach-small" role="status">{copyNotice}</p>}</section>}
    {item.state === 'approved' && !dirty && <p className="outreach-small">Select this approved version to schedule its tracking. Use the same send time you choose separately in Outlook.</p>}
    <dl className="outreach-timeline"><div><dt>Planned Outlook send time</dt><dd>{time(item.scheduledAt)}</dd></div><div><dt>Tracking starts</dt><dd>{time(item.trackingStartsAt)}</dd></div></dl>
    {item.state === 'scheduled' && <form className="outreach-reschedule" onSubmit={(event) => { event.preventDefault(); try { void onReschedule(item, scheduleIso(rescheduleTime)); } catch (failure) { setCopyNotice((failure as Error).message); } }}><label>Change the planned Outlook send time<input type="datetime-local" required value={rescheduleTime} disabled={disabled || dirty} onChange={(event) => setRescheduleTime(event.target.value)} /><span className="outreach-small">{timezone} · tracking begins 45 seconds later</span></label><button className="button secondary" type="submit" disabled={disabled || dirty}>Change tracking schedule</button><p className="outreach-small">Update Outlook’s scheduled email separately. This changes only when Maildesk starts recording image loads.</p></form>}
    {item.state === 'needs_attention' && <p className="outreach-small">Review this item before scheduling tracking. Maildesk does not send or confirm delivery of your email.</p>}
    {['scheduled', 'tracking'].includes(item.state) && <p className="outreach-small">Changing or cancelling tracking here does not change an email scheduled in Outlook. To change both, update both places. Tracking continues on the server even after you close this dashboard.</p>}
  </section>;
}

export default function OutreachQueue({ ownerEmail, pixelBaseUrl, development, active = true, onPixelsChanged }: {
  ownerEmail: string; pixelBaseUrl: string; development: boolean; active?: boolean; onPixelsChanged: () => Promise<unknown>;
}) {
  const [page, setPage] = useState<OutreachPage | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [prepareProgress, setPrepareProgress] = useState('');
  const busyRef = useRef(false);
  const [source, setSource] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [dirtyWarning, setDirtyWarning] = useState(false);
  const [discardRevision, setDiscardRevision] = useState(0);
  const [checked, setChecked] = useState<Record<string, number>>({});
  const [sendTime, setSendTime] = useState(localTimeAhead);
  const [confirmation, setConfirmation] = useState<{ sendAt: string; items: { id: string; version: number }[] } | null>(null);
  const [filter, setFilter] = useState('all');
  const fileRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const currentRequest = useRef(0);
  const refresh = useCallback(async () => {
    const requestId = ++currentRequest.current;
    const result = await request<OutreachPage>('/api/outreach');
    if (requestId === currentRequest.current) setPage(result);
  }, []);
  useEffect(() => {
    if (!active) return;
    let mounted = true;
    void refresh().catch((failure: Error) => { if (mounted) setError(failure.message); });
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !busyRef.current) void refresh().catch((failure: Error) => { if (mounted) setError(failure.message); });
    }, 5000);
    return () => { mounted = false; currentRequest.current += 1; window.clearInterval(timer); };
  }, [active, refresh]);
  useEffect(() => { if (!editorDirty) setDirtyWarning(false); }, [editorDirty]);
  const items = page?.items ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const approved = items.filter((item) => item.state === 'approved' && !item.doNotContact);
  const toPrepare = items.filter((item) => ['draft', 'cancelled', 'blocked'].includes(item.state) && !item.doNotContact && item.canEdit).slice(0, 100);
  const picks = approved.filter((item) => checked[item.id] === item.version).map(({ id, version }) => ({ id, version }));
  const visible = items.filter((item) => filter === 'all' || (filter === 'review' ? ['draft', 'prepared', 'approved'].includes(item.state) : filter === 'progress' ? ['scheduled', 'tracking'].includes(item.state) : item.doNotContact || ['blocked', 'needs_attention'].includes(item.state)));
  const confirmationCurrent = useMemo(() => confirmation && confirmation.items.every((pick) => items.some((item) => item.id === pick.id && item.version === pick.version && item.state === 'approved' && !item.doNotContact)), [confirmation, items]);
  function ensureSaved(): boolean {
    if (!editorDirty) return true;
    setDirtyWarning(true);
    return false;
  }
  async function action<T>(name: string, operation: () => Promise<T>, success: string): Promise<T | null> {
    if (busyRef.current) return null;
    if (name !== 'refresh' && !name.startsWith('save:') && !ensureSaved()) return null;
    busyRef.current = true; setBusy(name); setError(''); setNotice('');
    // An older polling response must not replace a just-completed mutation.
    currentRequest.current += 1;
    try {
      const result = await operation();
      await refresh();
      setNotice(success);
      await onPixelsChanged();
      return result;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'This change could not be saved.');
      await refresh().catch(() => undefined);
      return null;
    } finally { busyRef.current = false; setBusy(''); }
  }
  async function importDrafts(event: FormEvent) {
    event.preventDefault();
    let parsed: OutreachInput[];
    try { parsed = parseOutreachImport(source); } catch (failure) { setError((failure as Error).message); return; }
    const imported = await action('import', () => request<OutreachPage>('/api/outreach/import', 'POST', { items: parsed }), `${parsed.length} drafts imported for review. Nothing was sent.`);
    if (imported) { setSource(''); setShowImport(false); setSelectedId(imported.items[0]?.id ?? null); }
  }
  async function readFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { setError('Choose a JSON file smaller than 1 MB.'); return; }
    try { setSource(await file.text()); setShowImport(true); setError(''); }
    catch { setError('This file could not be read. You can paste its JSON instead.'); }
    if (fileRef.current) fileRef.current.value = '';
  }
  async function transition(item: OutreachItem, verb: 'prepare' | 'approve' | 'cancel') {
    const messages = { prepare: 'Logo and opt-out prepared. Review the complete message before approving it.', approve: `Version ${item.version} approved for ${item.recipient}.`, cancel: 'Tracking is stopped or cancelled. Saved history stays. Change any scheduled email separately in Outlook.' };
    return action(`${verb}:${item.id}`, () => request<OutreachItem>(`/api/outreach/${item.id}/${verb}`, 'POST', { version: item.version }), messages[verb]);
  }
  async function prepareBatch() {
    if (!toPrepare.length) return;
    const batch = [...toPrepare];
    await action('prepare-batch', async () => {
      let completed = 0;
      try {
        for (const item of batch) {
          setPrepareProgress(`Preparing ${completed + 1} of ${batch.length}…`);
          await request<OutreachItem>(`/api/outreach/${item.id}/prepare`, 'POST', { version: item.version });
          completed += 1;
        }
      } catch (failure) {
        throw new Error(`${completed} of ${batch.length} drafts prepared. ${failure instanceof Error ? failure.message : 'Preparation stopped.'} Review the queue before continuing.`);
      } finally { setPrepareProgress(''); }
    }, `${batch.length} drafts prepared with individual logos and opt-out links. Review and approve each complete version; nothing was sent.`);
  }
  function reviewSchedule(event: FormEvent) {
    event.preventDefault();
    if (!ensureSaved()) return;
    try { if (!picks.length) throw new Error('Select at least one approved version.'); setConfirmation({ sendAt: scheduleIso(sendTime), items: picks }); setError(''); }
    catch (failure) { setError((failure as Error).message); }
  }
  async function schedule() {
    if (!confirmation || !confirmationCurrent) return;
    const saved = await action('schedule', () => request<OutreachPage>('/api/outreach/schedule', 'POST', { ...confirmation, delaySeconds: DEFAULT_TRACKING_DELAY_SECONDS }), 'Tracking scheduled for 45 seconds after your planned Outlook send time. Schedule the email separately in Outlook.');
    if (saved) { setChecked({}); setConfirmation(null); }
  }
  return <div className="outreach-queue">
    <div className="page-heading"><div><div className="eyebrow">REVIEW FIRST. SEND WITH INTENTION.</div><h1>Your outreach, ready to review.</h1><p>Prepare your messages together, then schedule their tracking around your Outlook send time.</p></div><button className="button primary" onClick={() => setShowImport(!showImport)} aria-expanded={showImport}>{showImport ? 'Close import' : 'Import drafts'}</button></div>
    <div className="outreach-mode" role="status"><span className="outreach-mode-pill">TRACKING SCHEDULE</span><div><strong>You schedule the email in Outlook. Maildesk schedules only tracking.</strong><p>{page?.scheduling.description ?? 'Choose the exact send time you plan to use in Outlook. Tracking will start 45 seconds later.'} Drafts in Outlook or another chat stay untouched.</p></div></div>
    <ol className="outreach-steps" aria-label="Review workflow"><li><span>1</span>Import your copy</li><li><span>2</span>Prepare &amp; approve</li><li><span>3</span>Copy &amp; schedule in Outlook</li><li><span>4</span>Schedule tracking + 45 seconds</li></ol>
    {error && <div className="banner error" role="alert"><span>{error}</span><button className="text-button" disabled={!!busy} onClick={() => void action('refresh', refresh, 'Queue refreshed.')}>Refresh queue</button></div>}
    {notice && <div className="outreach-notice outreach-success" role="status">{notice}</div>}
    {(editorDirty || dirtyWarning) && <div className="outreach-notice outreach-warning" role={dirtyWarning ? 'alert' : 'status'}><strong>Save or discard changes before opening another draft or changing the review selection.</strong><p>Your unsaved text stays in the editor. Preparation, approval and scheduling wait until those changes are resolved.</p><button className="text-button" disabled={!!busy} onClick={() => { setDiscardRevision((value) => value + 1); setEditorDirty(false); setDirtyWarning(false); }}>Discard changes</button></div>}
    {(showImport || (page && items.length === 0)) && <section className="outreach-import" aria-label="Import reviewed drafts"><div className="outreach-section-head"><div><h2>Bring your drafts into Maildesk</h2><p>JSON only · up to 100 drafts per import · 1 MB maximum</p></div><input ref={fileRef} type="file" accept=".json,application/json" id="outreach-import-file" className="outreach-file-input" onChange={(event) => void readFile(event.target.files?.[0])} /><button className="button secondary" onClick={() => fileRef.current?.click()} disabled={!!busy}>Choose JSON file</button></div><form onSubmit={(event) => void importDrafts(event)}><label>Or paste a JSON array<textarea rows={7} value={source} onChange={(event) => setSource(event.target.value)} spellCheck={false} placeholder={'[{"label":"…","recipient":"…","subject":"…","body":"…"}]'} /></label><p className="outreach-small">Each item needs label, recipient, subject and body. The body is plain text; line breaks are preserved. Existing drafts stay unchanged, and importing does not approve or send anything.</p><button className="button primary" type="submit" disabled={!!busy || !source.trim()}>{busy === 'import' ? 'Importing…' : 'Import for review'}</button></form></section>}
    {!page && !error && <p className="outreach-loading" role="status">Loading your review queue…</p>}
    {page && <>
      <section className="outreach-schedule" aria-label="Schedule approved versions"><div><h2>Schedule tracking for approved messages</h2><p>Use the same planned send time you choose in Outlook. Maildesk starts tracking 45 seconds later and ignores earlier image requests.</p></div><form onSubmit={reviewSchedule}><label>Outlook scheduled send time<input type="datetime-local" required value={sendTime} disabled={!!busy || editorDirty} onChange={(event) => { setSendTime(event.target.value); setConfirmation(null); }} /><span className="outreach-small">{timezone}</span></label><div className="outreach-schedule-action"><strong>{picks.length} approved {picks.length === 1 ? 'version' : 'versions'} selected</strong><button className="button primary" type="submit" disabled={!!busy || editorDirty || !picks.length}>Review tracking schedule</button></div></form>{confirmation && <div className="outreach-schedule-confirm" role="region" aria-label="Confirm tracking schedule"><strong>{confirmation.items.length} {confirmation.items.length === 1 ? 'message' : 'messages'} · planned Outlook send {time(confirmation.sendAt)}</strong><p>Tracking starts {time(new Date(Date.parse(confirmation.sendAt) + DEFAULT_TRACKING_DELAY_SECONDS * 1000).toISOString())}, 45 seconds after that time, for these exact approved versions. Maildesk does not schedule, send or verify your email. Set the same time in Outlook; if that time changes, update both places.</p>{!confirmationCurrent && <p className="field-error">One or more selected versions changed. Review the selection again.</p>}<div><button className="button primary" disabled={!!busy || editorDirty || !confirmationCurrent} onClick={() => void schedule()}>{busy === 'schedule' ? 'Scheduling…' : 'Schedule tracking'}</button><button className="text-button" disabled={!!busy} onClick={() => setConfirmation(null)}>Back to review</button></div></div>}</section>
      {toPrepare.length > 0 && <section className="outreach-batch-prepare"><div><strong>Prepare {toPrepare.length} {toPrepare.length === 1 ? 'draft' : 'drafts'} together</strong><p>Add a separate tracking logo and recipient-bound opt-out link to each. This does not approve or schedule them.</p></div><button className="button secondary" disabled={!!busy || editorDirty} onClick={() => void prepareBatch()}>{busy === 'prepare-batch' ? prepareProgress || 'Preparing…' : `Prepare ${toPrepare.length} drafts`}</button></section>}
      <div className="outreach-workspace">
        <section className="outreach-list" aria-label="Draft review queue"><div className="outreach-section-head"><div><h2>Review queue <span className="outreach-count">{items.length}</span></h2><p>Each approval belongs to one saved version.</p></div><button className="text-button" disabled={!!busy} onClick={() => void action('refresh', refresh, 'Queue refreshed.')}>Refresh</button></div><div className="outreach-list-tools"><label>Show<select value={filter} onChange={(event) => { if (ensureSaved()) setFilter(event.target.value); }}><option value="all">All messages</option><option value="review">To review &amp; approve</option><option value="progress">Scheduled &amp; tracking</option><option value="attention">Needs attention</option></select></label><button className="text-button" disabled={!!busy || editorDirty || !approved.length} onClick={() => { setChecked(Object.fromEntries(approved.map((item) => [item.id, item.version]))); setConfirmation(null); }}>Select all approved</button>{picks.length > 0 && <button className="text-button" onClick={() => { setChecked({}); setConfirmation(null); }}>Clear selection</button>}</div><div className="outreach-rows">{visible.map((item) => <div key={item.id} className={`outreach-row${selectedId === item.id ? ' outreach-row-selected' : ''}`}><label className="outreach-row-check"><input type="checkbox" checked={checked[item.id] === item.version && item.state === 'approved' && !item.doNotContact} disabled={!!busy || editorDirty || item.state !== 'approved' || item.doNotContact} aria-label={`Select approved version of ${item.label}`} onChange={(event) => { setChecked({ ...checked, [item.id]: event.target.checked ? item.version : -1 }); setConfirmation(null); }} /></label><button className="outreach-row-open" aria-pressed={selectedId === item.id} onClick={() => { if (item.id !== selectedId && !ensureSaved()) return; setSelectedId(item.id); window.setTimeout(() => { if (window.innerWidth < 1100) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30); }}><strong>{item.label}</strong><span>{item.recipient}</span><span className="outreach-row-subject">{item.subject}</span><span className={`outreach-status outreach-status-${item.doNotContact ? 'blocked' : item.state}`}>{item.doNotContact ? 'Do not contact' : stateNames[item.state]}</span>{item.trackingStartsAt && <small>Tracking from {time(item.trackingStartsAt)}</small>}{item.scheduledAt && !item.trackingStartsAt && <small>Scheduled {time(item.scheduledAt)}</small>}</button></div>)}</div>{visible.length === 0 && <p className="outreach-empty">{items.length ? 'No messages match this view.' : 'Your imported drafts will appear here. Nothing has been scheduled.'}</p>}<div className="outreach-list-footer">{visible.length} of {items.length} messages · refreshes every 5 seconds</div></section>
        <div ref={editorRef} className="outreach-detail">{selected ? <DraftReview key={selected.id} item={selected} discardRevision={discardRevision} onDirtyChange={setEditorDirty} disabled={!!busy} ownerEmail={ownerEmail} pixelBaseUrl={pixelBaseUrl} onSave={(item, values) => action(`save:${item.id}`, () => request<OutreachItem>(`/api/outreach/${item.id}`, 'PATCH', { version: item.version, ...values }), 'Changes saved. Prepare and approve this new version before scheduling.')} onPrepare={(item) => transition(item, 'prepare')} onApprove={(item) => transition(item, 'approve')} onCancel={(item) => transition(item, 'cancel')} onReschedule={(item, sendAt) => action(`reschedule:${item.id}`, () => request<OutreachItem>(`/api/outreach/${item.id}/reschedule`, 'POST', { version: item.version, sendAt }), 'Tracking time updated. Update the scheduled email separately in Outlook.')} /> : <section className="outreach-start-hint"><div className="eyebrow">A COMPLETE VERSION, EVERY TIME</div><h2>Review the words.<br />Keep the safeguards.</h2><p>Open a draft to prepare its unique tracking logo and opt-out footer. Approve it once you’ve checked the complete message and its recipient.</p><p>Editing the saved text or recipient clears the approval. Opt-outs are checked again before scheduling and recording image loads.</p></section>}</div>
      </div>

    </>}
    <p className="outreach-footnote">Image-load emails respect your existing Maildesk Settings. Tracking ignores the first 45 seconds after your planned send time. It cannot identify a human reader: scanners may load later, and a cached preload or fast real open may never appear.</p>
  </div>;
}
