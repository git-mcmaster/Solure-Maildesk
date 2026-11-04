export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export const securityHeaders: Record<string, string> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data }), { status, headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' } });
}

export function errorResponse(error: unknown): Response {
  const known = error instanceof HttpError;
  return new Response(JSON.stringify({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : 'Something went wrong. Please try again.' } }), {
    status: known ? error.status : 500,
    headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'JSON_REQUIRED', 'Send a JSON request.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'INVALID_JSON', 'A JSON body is required.');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    size += item.value.byteLength;
    if (size > 16_384) { await reader.cancel(); throw new HttpError(413, 'BODY_TOO_LARGE', 'This request is too large.'); }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch { throw new HttpError(400, 'INVALID_JSON', 'Please provide a valid JSON object.'); }
}

export function stringField(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw new HttpError(400, 'INVALID_FIELD', `${name} must be text up to ${max} characters.`);
  return value.trim();
}

export function onlyFields(body: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new HttpError(400, 'UNKNOWN_FIELD', 'This request contains an unsupported field.');
}
