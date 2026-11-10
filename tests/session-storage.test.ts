import { describe, expect, it } from 'vitest';
import { createSessionCipher } from '../src/lib/session-crypto';
import { createEncryptedSessionDriver, type SessionBucket } from '../src/lib/session-storage';

class MemoryBucket implements SessionBucket {
  values = new Map<string, string>();
  async get(key: string) {
    const value = this.values.get(key);
    return value === undefined ? null : { async text() { return value; } };
  }
  async put(key: string, value: string) { this.values.set(key, value); }
  async delete(key: string) { this.values.delete(key); }
}

describe('encrypted EmDash sessions', () => {
  const secret = 'a'.repeat(64);

  it('round-trips session values without storing plaintext', async () => {
    const bucket = new MemoryBucket();
    const driver = createEncryptedSessionDriver({ binding: bucket, secret });
    await driver.setItem('session-id', '["private-user"]');
    expect([...bucket.values.keys()]).toEqual(['__tvfit_private_sessions__/session-id']);
    expect([...bucket.values.values()][0]).not.toContain('private-user');
    await expect(driver.getItem('session-id')).resolves.toBe('["private-user"]');
  });

  it('treats tampered and legacy plaintext values as missing sessions', async () => {
    const bucket = new MemoryBucket();
    bucket.values.set('__tvfit_private_sessions__/legacy', 'plaintext');
    const driver = createEncryptedSessionDriver({ binding: bucket, secret });
    await expect(driver.getItem('legacy')).resolves.toBeNull();
    await driver.setItem('session-id', 'value');
    const key = '__tvfit_private_sessions__/session-id';
    bucket.values.set(key, `${bucket.values.get(key)}x`);
    await expect(driver.getItem('session-id')).resolves.toBeNull();
  });

  it('binds ciphertext to its session key', async () => {
    const cipher = createSessionCipher(secret);
    const encrypted = await cipher.encrypt('value', 'first');
    await expect(cipher.decrypt(encrypted, 'first')).resolves.toBe('value');
    await expect(cipher.decrypt(encrypted, 'second')).resolves.toBeNull();
  });

  it('fails closed when the secret is too short', () => {
    expect(() => createSessionCipher('short')).toThrow(/32/u);
  });
});
