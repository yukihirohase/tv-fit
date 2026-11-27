/** EmDash's supported Cloudflare entrypoint, retaining native CMS behavior. */
import handler from '@emdash-cms/cloudflare/worker';
import { emdashAdminSlashRedirect, isPrivateSessionRequest } from './lib/private-session-guard';
import { canonicalHostRedirect, trailingSlashRedirect } from './lib/trailing-slash';
import { releaseConfiguredMigrationLock } from './lib/worker-migration-recovery';
import { isOfferCheckRequest, offerCheckRequest } from './lib/offer-schedule';

const fetchHandler = handler.fetch!;
const scheduledHandler = handler.scheduled!;

export default {
  ...handler,
  async fetch(...args: Parameters<typeof fetchHandler>) {
    if (isPrivateSessionRequest(args[0]) || isOfferCheckRequest(args[0])) {
      return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    const adminRedirect = emdashAdminSlashRedirect(args[0]);
    if (adminRedirect) return Response.redirect(adminRedirect, 308);
    const hostRedirect = canonicalHostRedirect(args[0], (args[1] as { PUBLIC_SITE_URL?: string } | undefined)?.PUBLIC_SITE_URL);
    if (hostRedirect) return Response.redirect(hostRedirect, 301);
    const slashRedirect = trailingSlashRedirect(args[0]);
    if (slashRedirect) return Response.redirect(slashRedirect, 301);
    await releaseConfiguredMigrationLock(args[1] as Record<string, unknown>);
    return fetchHandler(...args);
  },
  async scheduled(...args: Parameters<typeof scheduledHandler>) {
    // EmDash の定期処理（予約公開など）はそのまま動かす。
    await scheduledHandler(...args);
    const [, env, ctx] = args;
    // 販売情報（価格・在庫）のチェック。外部からは届かない経路で Astro のページを直接呼ぶ。
    ctx.waitUntil((async () => {
      try {
        const response = await fetchHandler(offerCheckRequest(env as unknown as Record<string, unknown>) as Parameters<typeof fetchHandler>[0], env, ctx);
        if (!response.ok) console.error('[offers] check failed:', response.status, await response.text());
      } catch (error) {
        console.error('[offers] check failed:', error);
      }
    })());
  },
};
