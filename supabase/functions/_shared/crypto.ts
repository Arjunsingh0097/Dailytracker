// AES-256-GCM encryption for GitHub tokens.
// Key material lives only in the GITHUB_TOKEN_ENC_KEY secret (32 raw bytes,
// base64-encoded). A random 12-byte IV is generated per token. Ciphertext
// is stored as base64; the token itself is never persisted in plaintext.

const KEY_VERSION = 1;
const IV_BYTES = 12;
const KEY_BYTES = 32;

export function currentKeyVersion(): number {
  return KEY_VERSION;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(): Promise<CryptoKey> {
  const raw = Deno.env.get('GITHUB_TOKEN_ENC_KEY');
  if (!raw) {
    throw new Error('GITHUB_TOKEN_ENC_KEY is not set');
  }
  const bytes = decodeBase64(raw.trim());
  if (bytes.length !== KEY_BYTES) {
    throw new Error('GITHUB_TOKEN_ENC_KEY must be exactly 32 bytes (base64)');
  }
  return await crypto.subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export interface EncryptedToken {
  ciphertext: string;
  iv: string;
  keyVersion: number;
}

export async function encryptToken(plaintext: string): Promise<EncryptedToken> {
  const key = await importKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    ciphertext: encodeBase64(new Uint8Array(ciphertext)),
    iv: encodeBase64(iv),
    keyVersion: KEY_VERSION,
  };
}

export async function decryptToken(ciphertext: string, iv: string): Promise<string> {
  const key = await importKey();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64(iv) },
    key,
    decodeBase64(ciphertext),
  );
  return new TextDecoder().decode(plain);
}
