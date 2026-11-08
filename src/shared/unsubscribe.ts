/** Header preparation only. A sending transport must DKIM-sign both fields. */
export interface UnsubscribeHeaderPreparation {
  oneClickUrl: string;
  headers: {
    'List-Unsubscribe': string;
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click';
  };
  headerText: string;
}

export interface PreparedUnsubscribeHeaders extends UnsubscribeHeaderPreparation {
  outreachId: string;
  version: number;
  recipient: string;
  status: 'prepared-only';
  transportVerified: false;
  dkimSigningRequired: true;
}

export interface ManualPreparedUnsubscribeHeaders extends UnsubscribeHeaderPreparation {
  pixelId: string;
  recipient: string;
  status: 'prepared-only';
  transportVerified: false;
  dkimSigningRequired: true;
}

const unsafe = /[\u0000-\u0020\u007f]/u;
const stopPath = /^\/outreach\/stop\/([a-f0-9]{64})$/u;

/** Preserve the existing recipient token; never generate another opt-out pair. */
export function prepareUnsubscribeHeaders(optOutUrl: string, pixelBaseUrl: string): UnsubscribeHeaderPreparation {
  let base: URL, link: URL;
  try {
    if (typeof optOutUrl !== 'string' || typeof pixelBaseUrl !== 'string' || unsafe.test(optOutUrl) || unsafe.test(pixelBaseUrl)) throw new Error();
    base = new URL(pixelBaseUrl);
    link = new URL(optOutUrl);
  } catch {
    throw new Error('Use a valid HTTPS public origin and recipient-bound opt-out address.');
  }
  const token = stopPath.exec(link.pathname)?.[1];
  if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash
    || link.protocol !== 'https:' || link.origin !== base.origin || link.username || link.password || link.search || link.hash || !token) {
    throw new Error('Use the HTTPS public origin and this message’s unchanged recipient-bound opt-out address.');
  }
  const oneClickUrl = new URL(`/outreach/unsubscribe/${token}`, base.origin).href;
  const headers: UnsubscribeHeaderPreparation['headers'] = {
    'List-Unsubscribe': `<${oneClickUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
  return { oneClickUrl, headers, headerText: `List-Unsubscribe: ${headers['List-Unsubscribe']}\r\nList-Unsubscribe-Post: ${headers['List-Unsubscribe-Post']}` };
}
