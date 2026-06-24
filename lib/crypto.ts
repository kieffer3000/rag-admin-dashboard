import 'server-only';
import crypto from 'crypto';

// AES-256-GCM for secrets at rest (BYOK OpenRouter keys). Format:
// "<iv b64>:<authTag b64>:<ciphertext b64>". Key from APP_ENCRYPTION_KEY (64-hex
// = 32 bytes; any other string is SHA-256'd to 32 bytes so it still works).
const ALGO = 'aes-256-gcm';

function keyBuf(): Buffer {
  const k = process.env.APP_ENCRYPTION_KEY ?? '';
  if (!k) throw new Error('APP_ENCRYPTION_KEY is not set');
  const hex = /^[0-9a-fA-F]{64}$/.test(k) ? Buffer.from(k, 'hex') : null;
  return hex ?? crypto.createHash('sha256').update(k).digest();
}

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv(ALGO, keyBuf(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(
    ':'
  );
}

export function decryptSecret(blob: string): string {
  const [iv, tag, enc] = blob.split(':');
  const d = crypto.createDecipheriv(ALGO, keyBuf(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
}
