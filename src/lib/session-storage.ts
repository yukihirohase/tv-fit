import { createSessionCipher } from './session-crypto';

type SessionDriverFactory = (config: Record<string, unknown> | undefined) => {
  getItem(key: string): Promise<unknown>;
  setItem(key: string, value: unknown): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const SESSION_PREFIX = '__tvfit_private_sessions__';

interface SessionObject {
  text(): Promise<string>;
}

export interface SessionBucket {
  get(key: string): Promise<SessionObject | null>;
  put(key: string, value: string): Promise<unknown>;
  delete(key: string): Promise<unknown>;
}

export function createEncryptedSessionDriver(options: { binding: SessionBucket; secret: string }) {
  const cipher = createSessionCipher(options.secret);
  const objectKey = (key: string) => `${SESSION_PREFIX}/${key}`;

  return {
    name: 'tv-fit-encrypted-r2-session',
    async getItem(key: string): Promise<string | null> {
      const object = await options.binding.get(objectKey(key));
      if (!object) return null;
      return cipher.decrypt(await object.text(), key);
    },
    async setItem(key: string, value: string): Promise<void> {
      await options.binding.put(objectKey(key), await cipher.encrypt(value, key));
    },
    async removeItem(key: string): Promise<void> {
      await options.binding.delete(objectKey(key));
    },
  };
}

const sessionDriver: SessionDriverFactory = () => {
  let driver: ReturnType<typeof createEncryptedSessionDriver> | undefined;
  async function resolveDriver() {
    if (driver) return driver;
    // This virtual module is supplied by workerd. Keeping the import dynamic
    // lets unit tests use the injected factory without a Cloudflare runtime.
    // @ts-expect-error cloudflare:workers is resolved by the Cloudflare adapter.
    const { env } = await import('cloudflare:workers');
    const binding = env.MEDIA as unknown as SessionBucket;
    const secret = env.EMDASH_ENCRYPTION_KEY;
    if (!binding || typeof binding.get !== 'function') throw new Error('The MEDIA R2 binding is unavailable.');
    if (typeof secret !== 'string') throw new Error('EMDASH_ENCRYPTION_KEY is unavailable.');
    driver = createEncryptedSessionDriver({ binding, secret });
    return driver;
  }
  return {
    async getItem(key: string) { return (await resolveDriver()).getItem(key); },
    async setItem(key: string, value: unknown) { await (await resolveDriver()).setItem(key, String(value)); },
    async removeItem(key: string) { await (await resolveDriver()).removeItem(key); },
  };
};

export default sessionDriver;
