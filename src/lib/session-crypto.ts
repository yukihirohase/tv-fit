const encoder = new TextEncoder();
const decoder = new TextDecoder();

type CryptoLike = Pick<Crypto, 'subtle' | 'getRandomValues'>;

interface SessionEnvelope {
  v: 1;
  iv: string;
  data: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export function createSessionCipher(secret: string, cryptoProvider: CryptoLike = globalThis.crypto) {
  if (secret.length < 32) throw new Error('EMDASH_ENCRYPTION_KEY must be at least 32 characters.');

  const keyPromise = cryptoProvider.subtle
    .digest('SHA-256', encoder.encode(`tv-fit-session-v1:${secret}`))
    .then(bytes => cryptoProvider.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']));

  return {
    async encrypt(serialized: string, sessionKey: string): Promise<string> {
      const iv = cryptoProvider.getRandomValues(new Uint8Array(12));
      const data = await cryptoProvider.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: encoder.encode(sessionKey) },
        await keyPromise,
        encoder.encode(serialized),
      );
      return JSON.stringify({ v: 1, iv: toBase64(iv), data: toBase64(new Uint8Array(data)) } satisfies SessionEnvelope);
    },

    async decrypt(envelope: string, sessionKey: string): Promise<string | null> {
      try {
        const parsed = JSON.parse(envelope) as Partial<SessionEnvelope>;
        if (parsed.v !== 1 || typeof parsed.iv !== 'string' || typeof parsed.data !== 'string') return null;
        const iv = fromBase64(parsed.iv);
        if (iv.byteLength !== 12) return null;
        const plain = await cryptoProvider.subtle.decrypt(
          { name: 'AES-GCM', iv: iv as BufferSource, additionalData: encoder.encode(sessionKey) as BufferSource },
          await keyPromise,
          fromBase64(parsed.data) as BufferSource,
        );
        return decoder.decode(plain);
      } catch {
        return null;
      }
    },
  };
}
