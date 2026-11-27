/**
 * 公開ページの URL を末尾スラッシュ付きに統一する。
 * trailingSlash: 'ignore' のままだと /about と /about/ の両方が 200 を返し、
 * 検索エンジンに重複 URL として扱われるため、スラッシュ無しを 301 で正規 URL へ送る。
 * ファイル（robots.txt・sitemap.xml・*.json など）と EmDash・Astro の内部経路は対象外。
 */
export function trailingSlashRedirect(request: { method: string; url: string }): URL | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  const { pathname } = url;
  if (pathname.endsWith('/') || pathname.startsWith('/_') || pathname.startsWith('/internal/')) return null;
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  if (last.includes('.')) return null;
  url.pathname = `${pathname}/`;
  return url;
}

/** canonical 用のパス。ページは常に末尾スラッシュ付き。 */
export function canonicalPagePath(pathname: string): string {
  if (pathname.endsWith('/')) return pathname;
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  return last.includes('.') ? pathname : `${pathname}/`;
}
