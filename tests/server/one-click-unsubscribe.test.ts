import { readFile, readdir } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Miniflare } from 'miniflare';
import { fetchDashboard } from '../../src/server/dashboard';
import { fetchPixel } from '../../src/server/pixel';
import type { Env, OptOutLink, Pixel } from '../../src/server/types';

let mf: Miniflare;
let env: Env;
const origin = 'http://127.0.0.1:8787';
const migrations = new URL('../../migrations/', import.meta.url);

beforeAll(async () => {
  mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("test"); } };', compatibilityDate: '2026-07-30', d1Databases: { DB: 'maildesk-one-click-tests' } });
  const DB = await mf.getD1Database('DB') as unknown as D1Database;
  for (const file of (await readdir(migrations)).filter(name => name.endsWith('.sql')).sort()) {
    const sql = (await readFile(new URL(file, migrations), 'utf8')).replace(/--[^\n]*/gu, '');
    const triggerAt = sql.indexOf('CREATE TRIGGER');
    const setup = (triggerAt < 0 ? sql : sql.slice(0, triggerAt)).split(';').map(part => part.trim()).filter(Boolean);
    await DB.batch(setup.map(statement => DB.prepare(statement)));
    if (triggerAt >= 0) await DB.prepare(sql.slice(triggerAt)).run();
  }
  env = { DB, OWNER_EMAIL: 'elijah@soluredigitalworks.com', DASHBOARD_ORIGIN: origin, PIXEL_ORIGIN: 'http://127.0.0.1:8788', DEV_AUTH: 'true', EMAIL_MODE: 'dry-run' };
}, 30_000);

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM outreach_jobs'), env.DB.prepare('DELETE FROM opt_out_links'), env.DB.prepare('DELETE FROM do_not_contact'),
    env.DB.prepare('DELETE FROM pixel_reports'), env.DB.prepare('DELETE FROM notifications'), env.DB.prepare('DELETE FROM events'), env.DB.prepare('DELETE FROM pixels'),
    env.DB.prepare('UPDATE settings SET email_enabled=0,repeat_alerts=0,capture_request_details=0,event_day=NULL,event_count=0 WHERE id=1'),
  ]);
});
afterEach(() => { vi.restoreAllMocks(); });
afterAll(async () => { await mf?.dispose(); });

async function api<T>(path: string, method = 'GET', body?: unknown) {
  const response = await fetchDashboard(new Request(`${origin}${path}`, { method, headers: { Origin: origin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env);
  return { response, ...await response.json() as { data: T; error?: { code: string } } };
}

async function linked(recipient = 'Client+shop@Example.COM') {
  const created = await api<Pixel>('/api/pixels', 'POST', { label: 'Private proposal label', recipient, notes: 'Private owner notes' });
  expect(created.response.status).toBe(201);
  const saved = await api<OptOutLink>(`/api/pixels/${created.data.id}/opt-out-link`, 'POST', {});
  expect(saved.response.status).toBe(200);
  return { pixel: created.data, link: saved.data, url: saved.data.url.replace('/outreach/stop/', '/outreach/unsubscribe/') };
}

function post(url: string, body: BodyInit = 'List-Unsubscribe=One-Click', headers: HeadersInit = { 'Content-Type': 'application/x-www-form-urlencoded' }, override: Partial<Env> = {}) {
  return fetchPixel(new Request(url, { method: 'POST', headers, body }), { ...env, ...override });
}

async function counts() {
  return env.DB.prepare(`SELECT (SELECT COUNT(*) FROM events) events,(SELECT COUNT(*) FROM notifications) notifications,
    (SELECT COUNT(*) FROM opt_out_links) links,(SELECT COUNT(*) FROM do_not_contact) blocked`).first();
}

describe('RFC 8058 one-click unsubscribe', () => {
  it('accepts the mailbox-service POST without Origin, cookies or dashboard authentication and saves only the bound preference', async () => {
    const { pixel, link, url } = await linked();
    const response = await post(url, 'List-Unsubscribe=One-Click', { 'Content-Type': 'application/x-www-form-urlencoded', 'CF-Connecting-IP': '198.51.100.10', 'User-Agent': 'Mailbox service' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Location')).toBeNull();
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const html = await response.text();
    expect(html).toContain('Your preference has been saved');
    for (const privateText of [pixel.recipient, link.recipient, pixel.id, pixel.label, pixel.notes, env.OWNER_EMAIL]) expect(html).not.toContain(privateText);
    expect(await env.DB.prepare('SELECT * FROM do_not_contact').first()).toEqual({ recipient: 'client+shop@example.com', created_at: expect.any(String), source: 'recipient' });
    expect(await counts()).toEqual({ events: 0, notifications: 0, links: 1, blocked: 1 });
  });

  it('accepts a single multipart field and an explicitly cross-site mail-service POST', async () => {
    const { url } = await linked();
    const form = new FormData();
    form.set('List-Unsubscribe', 'One-Click');
    const response = await post(url, form, { Origin: 'https://mailbox.example', 'Sec-Fetch-Site': 'cross-site' });
    expect(response.status).toBe(200);
    expect((await counts())?.blocked).toBe(1);
  });

  it('keeps GET, HEAD and scanner-query visits read-only and submits browser confirmation to the original guarded route', async () => {
    const { pixel, link, url } = await linked();
    const before = await counts();
    for (const suffix of ['', '?List-Unsubscribe=One-Click', '?confirm=stop&recipient=other@example.com']) {
      for (const method of ['GET', 'HEAD']) {
        const response = await fetchPixel(new Request(url + suffix, { method, headers: { 'User-Agent': 'Email security scanner' } }), env);
        expect(response.status).toBe(200);
        expect(response.headers.get('Location')).toBeNull();
        expect(response.headers.get('Cache-Control')).toBe('no-store');
        expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
        const html = await response.text();
        if (method === 'HEAD') expect(html).toBe('');
        else {
          expect(html).toContain(`action="${new URL(link.url).pathname}"`);
          expect(html).toContain('Simply visiting this page does not change your preference');
          for (const privateText of [pixel.recipient, link.recipient, pixel.id, pixel.label, pixel.notes, env.OWNER_EMAIL]) expect(html).not.toContain(privateText);
        }
      }
    }
    expect(await counts()).toEqual(before);
  });

  it('preserves the existing browser route and its Origin, cross-site and confirmation requirements', async () => {
    const { link } = await linked();
    const originCases: Record<string, string>[] = [
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://other.example' },
      { 'Content-Type': 'application/x-www-form-urlencoded', Origin: new URL(link.url).origin, 'Sec-Fetch-Site': 'cross-site' },
    ];
    for (const headers of originCases) expect((await post(link.url, 'confirm=stop', headers)).status).toBe(403);
    expect((await post(link.url)).status).toBe(403);
    expect((await counts())?.blocked).toBe(0);
    expect((await post(link.url, 'confirm=stop', { 'Content-Type': 'application/x-www-form-urlencoded', Origin: new URL(link.url).origin })).status).toBe(200);
    expect((await counts())?.blocked).toBe(1);
  });

  it('rejects empty, wrong, duplicate, extra, malformed and oversized urlencoded fields', async () => {
    const { url } = await linked();
    for (const body of ['', 'confirm=stop', 'list-unsubscribe=One-Click', 'List-Unsubscribe=one-click', 'List-Unsubscribe=One-Click&List-Unsubscribe=One-Click', 'List-Unsubscribe=One-Click&email=other@example.com', 'List-Unsubscribe=One-Click&', 'List-Unsubscribe=One-Click%ZZ', 'List-Unsubscribe=One-Click' + 'x'.repeat(4096)]) {
      expect((await post(url, body)).status).toBe(400);
    }
    expect((await post(url, new Uint8Array([0xff, 0xfe]))).status).toBe(400);
    expect((await post(url, 'List-Unsubscribe=One-Click', {})).status).toBe(400);
    expect((await post(url, 'List-Unsubscribe=One-Click', { 'Content-Type': 'application/json' })).status).toBe(400);
    // A forged small Content-Length does not bypass the streamed body limit.
    expect((await post(url, 'List-Unsubscribe=One-Click' + 'x'.repeat(4096), { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': '1' })).status).toBe(400);
    expect((await counts())?.blocked).toBe(0);
  });

  it('rejects multipart duplicates, extra fields, uploaded files and malformed boundaries without mutating preferences', async () => {
    const { url } = await linked();
    for (const kind of ['duplicate', 'extra', 'file', 'wrong', 'oversized']) {
      const form = new FormData();
      if (kind === 'file') form.append('List-Unsubscribe', new Blob(['One-Click']), 'value.txt');
      else form.append('List-Unsubscribe', kind === 'wrong' ? 'No' : kind === 'oversized' ? 'x'.repeat(4096) : 'One-Click');
      if (kind === 'duplicate') form.append('List-Unsubscribe', 'One-Click');
      if (kind === 'extra') form.append('recipient', 'other@example.com');
      expect((await post(url, form, {})).status).toBe(400);
    }
    for (const [type, body] of [
      ['multipart/form-data', 'List-Unsubscribe=One-Click'],
      ['multipart/form-data; boundary=test', '--test\r\nContent-Disposition: form-data; name="List-Unsubscribe"\r\n\r\nOne-Click'],
      ['multipart/form-data; boundary=test', '--wrong--\r\n'],
    ]) expect((await post(url, body, { 'Content-Type': type! })).status).toBe(400);
    expect((await counts())?.blocked).toBe(0);
  });

  it('returns 404 for unavailable tokens, 405 for unsupported methods, and never redirects', async () => {
    const { url } = await linked();
    for (const value of [url.replace(/\/[^/]+$/u, '/bad'), url.replace(/\/[^/]+$/u, '/' + '0'.repeat(64))]) {
      expect((await fetchPixel(new Request(value), env)).status).toBe(404);
      expect((await post(value)).status).toBe(404);
    }
    for (const method of ['PUT', 'DELETE', 'OPTIONS']) {
      const response = await fetchPixel(new Request(url, { method }), env);
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('GET, HEAD, POST');
      expect(response.headers.get('Location')).toBeNull();
    }
    expect((await counts())?.blocked).toBe(0);
  });

  it('is idempotent and applies existing suppression triggers while preserving past activity', async () => {
    const { pixel, link, url } = await linked();
    expect((await api<Pixel>(`/api/pixels/${pixel.id}`, 'PATCH', { status: 'armed', enableEmailAlerts: true })).response.status).toBe(200);
    await fetchPixel(new Request(pixel.pixelUrl), env);
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO outreach_jobs(id,state,label,recipient,subject,body,pixel_id,created_at,updated_at,approved_at,approved_version,prepared_html,prepared_text)
      VALUES('one-click-job','approved','Test job',?,'Test','Test',?,?,?,?,1,'<p>Test</p>','Test')`).bind(link.recipient, pixel.id, now, now, now).run();
    const before = await counts();
    expect(before).toMatchObject({ events: 1, notifications: 1, blocked: 0 });
    expect((await post(url)).status).toBe(200);
    const saved = await env.DB.prepare('SELECT * FROM do_not_contact').first();
    expect((await post(url)).status).toBe(200);
    expect(await env.DB.prepare('SELECT * FROM do_not_contact').first()).toEqual(saved);
    expect(await env.DB.prepare('SELECT state FROM outreach_jobs').first('state')).toBe('blocked');
    expect(await env.DB.prepare('SELECT status FROM pixels').first('status')).toBe('paused');
    expect(await env.DB.prepare('SELECT status FROM notifications').first('status')).toBe('disabled');
    await fetchPixel(new Request(pixel.pixelUrl), env);
    expect(await counts()).toEqual({ ...before, blocked: 1 });
    expect((await api<Pixel>(`/api/pixels/${pixel.id}`, 'PATCH', { status: 'armed' })).response.status).toBe(409);
    expect((await api<OptOutLink>(`/api/pixels/${pixel.id}/opt-out-link`, 'POST', {})).response.status).toBe(409);
  });

  it('keeps the capability bound to the original recipient through pixel edits and deletion', async () => {
    const { pixel, link, url } = await linked('original@example.com');
    expect((await api<Pixel>(`/api/pixels/${pixel.id}`, 'PATCH', { recipient: 'changed@example.com' })).response.status).toBe(200);
    expect((await post(url)).status).toBe(200);
    expect(await env.DB.prepare('SELECT recipient FROM do_not_contact').first('recipient')).toBe(link.recipient);
    expect((await api<Pixel>(`/api/pixels/${pixel.id}`)).data.doNotContact).toBe(false);
    expect((await api<unknown>(`/api/pixels/${pixel.id}`, 'DELETE')).response.status).toBe(200);
    expect((await post(url)).status).toBe(200);
    expect((await counts())?.links).toBe(1);
    expect((await counts())?.blocked).toBe(1);
  });

  it('returns a bounded error without revealing token or database details when storage fails', async () => {
    const { url } = await linked();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const DB = { prepare: vi.fn(() => { throw new Error('Private storage failure'); }) } as unknown as D1Database;
    const response = await post(url, undefined, undefined, { DB });
    expect(response.status).toBe(503);
    expect(response.headers.get('Location')).toBeNull();
    const body = await response.text();
    expect(body).toContain('We could not save your preference');
    expect(body).not.toContain('Private storage failure');
    expect(body).not.toContain(new URL(url).pathname.split('/').at(-1));
    expect(log).toHaveBeenCalledExactlyOnceWith('One-click unsubscribe request failed');
    expect((await counts())?.blocked).toBe(0);
  });
});
