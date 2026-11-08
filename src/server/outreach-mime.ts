import { prepareUnsubscribeHeaders } from '../shared/unsubscribe';
import { normalizedRecipient } from './opt-out';

export interface MimeMessage {
  from: string;
  recipient: string;
  subject: string;
  html: string;
  text: string;
  messageId: string;
  optOutUrl: string;
  pixelOrigin: string;
  date: Date;
}

function base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function foldedBase64(value: string): string {
  return base64(value).match(/.{1,76}/gu)?.join('\r\n') ?? '';
}
function encodedSubject(subject: string): string {
  if (!subject || subject.length > 200 || /[\r\n\u0000-\u001f\u007f]/u.test(subject)) throw new Error('Invalid message subject');
  // Split by code point, never inside a UTF-8 sequence, and keep encoded-words under 75 characters.
  const chunks: string[] = []; let chunk = '';
  for (const point of subject) {
    if (new TextEncoder().encode(chunk + point).length > 42) { chunks.push(chunk); chunk = ''; }
    chunk += point;
  }
  if (chunk) chunks.push(chunk);
  return chunks.map(value => `=?UTF-8?B?${base64(value)}?=`).join('\r\n ');
}

/** Build the exact approved body; no remote resources are fetched during assembly. */
export function outreachMime(message: MimeMessage): { mime: string; base64: string } {
  const from = normalizedRecipient(message.from), recipient = normalizedRecipient(message.recipient);
  if (!/^<[a-f0-9-]{36}@maildesk\.[a-z0-9.-]+>$/u.test(message.messageId) || !Number.isFinite(message.date.getTime())) throw new Error('Invalid message identity');
  if (!message.html || !message.text || message.html.length > 100_000 || message.text.length > 100_000) throw new Error('Invalid approved body');
  const headers = prepareUnsubscribeHeaders(message.optOutUrl, message.pixelOrigin);
  const boundary = `maildesk_${message.messageId.slice(1, 37).replaceAll('-', '')}`;
  const mime = [
    `From: ${from}`, `To: ${recipient}`, `Subject: ${encodedSubject(message.subject)}`,
    `Date: ${message.date.toUTCString()}`, `Message-ID: ${message.messageId}`, 'MIME-Version: 1.0',
    headers.headerText, `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', foldedBase64(message.text),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', foldedBase64(message.html),
    `--${boundary}--`, '',
  ].join('\r\n');
  return { mime, base64: base64(mime) };
}
