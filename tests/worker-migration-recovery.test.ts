import { describe, expect, it, vi } from 'vitest';
import { releaseConfiguredMigrationLock } from '../src/lib/worker-migration-recovery';

describe('one-time migration lock recovery', () => {
  it('uses an exact conditional update for the configured lock', async () => {
    const run = vi.fn(async () => undefined);
    const bind = vi.fn(() => ({ run }));
    const prepare = vi.fn(() => ({ bind }));
    await releaseConfiguredMigrationLock({ DB: { prepare }, EMDASH_RECOVER_MIGRATION_LOCK: '1794312812010' });
    expect(prepare).toHaveBeenCalledWith('UPDATE _emdash_migrations_lock SET is_locked = 0 WHERE id = ? AND is_locked = ?');
    expect(bind).toHaveBeenCalledWith('migration_lock', 1794312812010);
    expect(run).toHaveBeenCalledOnce();
  });

  it('does nothing without the exact numeric lock id', async () => {
    const prepare = vi.fn();
    await releaseConfiguredMigrationLock({ DB: { prepare } });
    await releaseConfiguredMigrationLock({ DB: { prepare }, EMDASH_RECOVER_MIGRATION_LOCK: 'latest' });
    expect(prepare).not.toHaveBeenCalled();
  });
});
