import { useEffect, useRef, useState } from 'react';
import { prepareUnsubscribeHeaders, type UnsubscribeHeaderPreparation } from '../shared/unsubscribe';

type Binding = { kind: 'outreach'; id: string; version: number } | { kind: 'pixel'; id: string };
type Prepared = UnsubscribeHeaderPreparation & {
  recipient: string;
  status: 'prepared-only';
  transportVerified: false;
  dkimSigningRequired: true;
  outreachId?: string;
  pixelId?: string;
  version?: number;
};

/** These are sender-integration instructions, never a send or activation action. */
export default function UnsubscribeSetup({ binding, recipient, optOutUrl, pixelBaseUrl, disabled }: {
  binding: Binding; recipient: string; optOutUrl: string; pixelBaseUrl: string; disabled: boolean;
}) {
  const path = binding.kind === 'outreach'
    ? `/api/outreach/${binding.id}/unsubscribe-headers?version=${binding.version}`
    : `/api/pixels/${binding.id}/unsubscribe-headers?recipient=${encodeURIComponent(recipient)}`;
  const identity = `${path}\n${recipient}\n${optOutUrl}\n${pixelBaseUrl}`;
  const current = useRef(identity);
  current.current = disabled ? '' : identity;
  const generation = useRef(0);
  const pending = useRef<AbortController | null>(null);
  const [prepared, setPrepared] = useState<{ identity: string; value: Prepared } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    generation.current += 1;
    pending.current?.abort();
    setPrepared(null); setBusy(false); setNotice('');
    return () => { generation.current += 1; pending.current?.abort(); };
  }, [identity, disabled]);

  async function prepare(copy: boolean) {
    if (disabled || busy) return;
    const requestId = ++generation.current;
    const controller = new AbortController();
    pending.current?.abort(); pending.current = controller;
    setBusy(true); setNotice(''); setPrepared(null);
    try {
      // Fetch again before copying: a cached preview must not bypass a newly
      // saved opt-out, changed recipient, or changed approved version.
      const response = await fetch(path, { signal: controller.signal, cache: 'no-store' });
      const payload = await response.json() as { data?: Prepared; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Headers could not be prepared. Refresh this message and try again.');
      const value = payload.data;
      const expected = prepareUnsubscribeHeaders(optOutUrl, pixelBaseUrl);
      if (value.status !== 'prepared-only' || value.transportVerified !== false || value.dkimSigningRequired !== true
        || value.recipient !== recipient.trim().toLowerCase() || value.oneClickUrl !== expected.oneClickUrl
        || value.headerText !== expected.headerText || value.headers?.['List-Unsubscribe'] !== expected.headers['List-Unsubscribe']
        || value.headers?.['List-Unsubscribe-Post'] !== expected.headers['List-Unsubscribe-Post']
        || (binding.kind === 'outreach' ? value.outreachId !== binding.id || value.version !== binding.version : value.pixelId !== binding.id)) {
        throw new Error('These headers do not match the current saved message. Refresh before continuing.');
      }
      if (requestId !== generation.current || current.current !== identity) return;
      setPrepared({ identity, value });
      if (copy) {
        await navigator.clipboard.writeText(value.headerText);
        if (requestId !== generation.current || current.current !== identity) return;
        setNotice('Provider headers copied. Your sending integration must add and DKIM-sign them. Nothing was sent or activated.');
      } else setNotice('Provider headers prepared. Sending and DKIM signing have not been verified.');
    } catch (error) {
      if (requestId === generation.current && current.current === identity && !controller.signal.aborted) {
        setNotice(error instanceof Error ? error.message : 'Headers could not be prepared. Try again.');
      }
    } finally { if (requestId === generation.current) setBusy(false); }
  }

  const visible = !disabled && prepared?.identity === identity ? prepared.value : null;
  return <details className="unsubscribe-setup">
    <summary>One-click unsubscribe setup <span>Sending not verified</span></summary>
    <div className="unsubscribe-setup-body">
      <p>These headers let a compatible mail service request an unsubscribe. Your email-sending integration must add them and cover both with a valid DKIM signature.</p>
      <p>Pasting headers into an Outlook message or signature does not enable its Unsubscribe control. Your existing footer still opens the confirmation page.</p>
      <p>Maildesk cannot cancel emails already scheduled in Outlook. Check do-not-contact before sending and cancel any pending outreach for an opted-out address.</p>
      <div className="unsubscribe-setup-actions">
        <button type="button" className="text-button" disabled={disabled || busy} onClick={() => void prepare(false)}>{busy ? 'Checking saved message…' : 'Prepare provider headers'}</button>
        {visible && <button type="button" className="text-button" disabled={disabled || busy} onClick={() => void prepare(true)}>Copy provider headers</button>}
      </div>
      {visible && <label>Headers for {visible.recipient}<textarea readOnly spellCheck={false} rows={5} value={visible.headerText} aria-label="One-click unsubscribe email headers" /></label>}
      {notice && <p role="status">{notice}</p>}
    </div>
  </details>;
}
