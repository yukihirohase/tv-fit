interface RecoveryDatabase {
  prepare(query: string): { bind(...values: unknown[]): { run(): Promise<unknown> } };
}

/**
 * One-time recovery for a lock whose exact id was reported by EmDash after a
 * canceled first migration. The conditional update cannot release a newer
 * migrator's lock. Remove the environment value after recovery.
 */
export async function releaseConfiguredMigrationLock(env: Record<string, unknown>): Promise<void> {
  const lock = env.EMDASH_RECOVER_MIGRATION_LOCK;
  const database = env.DB as RecoveryDatabase | undefined;
  if (typeof lock !== 'string' || !/^[1-9]\d{0,15}$/u.test(lock) || !database) return;
  await database
    .prepare('UPDATE _emdash_migrations_lock SET is_locked = 0 WHERE id = ? AND is_locked = ?')
    .bind('migration_lock', Number(lock))
    .run();
}
