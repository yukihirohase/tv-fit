/** EmDash's supported Cloudflare entrypoint, retaining native CMS behavior. */
import handler from '@emdash-cms/cloudflare/worker';
import { emdashAdminSlashRedirect, isPrivateSessionRequest } from './lib/private-session-guard';
import { releaseConfiguredMigrationLock } from './lib/worker-migration-recovery';

const fetchHandler = handler.fetch!;

export default {
  ...handler,
  async fetch(...args: Parameters<typeof fetchHandler>) {
    if (isPrivateSessionRequest(args[0])) {
      return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    }
    const adminRedirect = emdashAdminSlashRedirect(args[0]);
    if (adminRedirect) return Response.redirect(adminRedirect, 308);
    await releaseConfiguredMigrationLock(args[1] as Record<string, unknown>);
    return fetchHandler(...args);
  },
};
