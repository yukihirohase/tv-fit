/** Session objects share an R2 binding with media, but never a public URL. */
const PRIVATE_SESSION_PREFIX = '__tvfit_private_sessions__';

export function isPrivateSessionRequest(input: string | { url: string }): boolean {
  let value: string;
  try {
    const url = new URL(typeof input === 'string' ? input : input.url);
    value = `${url.pathname}${url.search}`;
  } catch {
    return true;
  }
  // Decode multiple layers defensively: media routes and query parsers may
  // each decode once. Checking the prefix blocks both ':' and '/' forms.
  for (let count = 0; count < 4; count += 1) {
    if (value.toLowerCase().includes(PRIVATE_SESSION_PREFIX)) return true;
    try {
      const decoded = decodeURIComponent(value);
      if (decoded === value) return false;
      value = decoded;
    } catch {
      // URLSearchParams tolerates malformed escapes; inspect valid ASCII
      // escapes too without rejecting harmless values such as a literal %.
      const decoded = value.replace(/%([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
      if (decoded === value) return false;
      value = decoded;
    }
  }
  return value.toLowerCase().includes(PRIVATE_SESSION_PREFIX);
}

/** EmDash setup redirects omit the slash required by this Astro site. */
export function emdashAdminSlashRedirect(input: string | { url: string }): URL | null {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (!url.pathname.startsWith('/_emdash/admin') || url.pathname.endsWith('/')) return null;
  url.pathname += '/';
  return url;
}
