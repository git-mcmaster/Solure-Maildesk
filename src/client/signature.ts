export type EmailImageFormat = 'signature' | 'pixel';

const website = 'https://soluredigitalworks.com';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]!);
}

export function imageAddresses(pixelUrl: string): { logo: string; preview: string; pixel: string } {
  const url = new URL(pixelUrl);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !/^\/p\/[a-f0-9]{32}\.gif$/u.test(url.pathname)) {
    throw new Error('This message does not have a valid tracking image address.');
  }
  url.search = '';
  url.hash = '';
  const pixel = url.href;
  url.pathname = url.pathname.replace(/\.gif$/u, '/logo.png');
  const logo = url.href;
  url.pathname = '/brand/solure-logo-v1.png';
  return { logo, preview: url.href, pixel };
}

export function emailContent(pixelUrl: string, ownerEmail: string, format: EmailImageFormat): { html: string; plainText: string } {
  const images = imageAddresses(pixelUrl);
  if (format === 'pixel') {
    return {
      html: `<img src="${escapeHtml(images.pixel)}" width="1" height="1" alt="" style="width:1px;height:1px;border:0;" />`,
      plainText: '',
    };
  }
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u.test(ownerEmail)) {
    throw new Error('The signature email address is not valid.');
  }
  const mailto = `mailto:${encodeURIComponent(ownerEmail).replace(/%40/gu, '@')}`;
  return {
    html: `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;color:#0e141b;text-align:left;max-width:100%;"><tr><td style="width:48px;padding:0 12px 0 0;vertical-align:top;"><img src="${escapeHtml(images.logo)}" width="48" height="50" alt="Solure Digital Works logo" style="display:block;width:48px;height:50px;border:0;" /></td><td style="padding:0;vertical-align:middle;"><strong style="font-size:14px;line-height:20px;">Elijah McMaster</strong><br /><span style="font-size:12px;line-height:18px;">Solure Digital Works</span></td></tr><tr><td colspan="2" style="padding:8px 0 0;font-size:12px;line-height:19px;overflow-wrap:anywhere;"><a href="${escapeHtml(mailto)}" style="color:#334b61;text-decoration:underline;">${escapeHtml(ownerEmail)}</a><br /><a href="${website}" style="color:#334b61;text-decoration:underline;">soluredigitalworks.com</a></td></tr></table>`,
    plainText: `Elijah McMaster\nSolure Digital Works\n${ownerEmail}\nsoluredigitalworks.com`,
  };
}
