// Modified by PrimusPost, 2026-08-15: token envelope encryption via Google Cloud KMS and AES-256-GCM. See NOTICE.md.
/**
 * PrimusPost fork — encryption at rest for social OAuth tokens.
 *
 * WHY THIS EXISTS
 *
 * Upstream stores `Integration.token` and `Integration.refreshToken` in
 * plaintext. Anyone who can read the database — through a compromise, a leaked
 * connection string, or a downloaded backup — can post as every connected
 * account without touching the application. For a multi-tenant deployment that
 * is the single highest-value target in the system.
 *
 * DESIGN: ENVELOPE ENCRYPTION (Google Cloud KMS)
 *
 * Rather than holding a long-lived AES key in an environment variable, we follow
 * Google's documented envelope-encryption pattern:
 *
 *   - a fresh 256-bit Data Encryption Key (DEK) is generated per write
 *   - the value is encrypted locally with AES-256-GCM using that DEK
 *   - Cloud KMS wraps the DEK with a Key Encryption Key (KEK) that NEVER leaves
 *     KMS
 *   - the wrapped DEK is stored alongside the ciphertext; the plaintext DEK is
 *     never persisted
 *
 * The operational property that matters: this host never holds a durable
 * decryption key. It holds *permission to unwrap*, which is revocable with a
 * single IAM change. A leaked static key is leaked forever; a compromised
 * service account can be cut off in seconds. It also produces a Cloud Audit Log
 * entry per key use, and makes rotation a KMS operation rather than a
 * re-encryption project.
 *
 * STORED FORMAT
 *
 *   enc:v1:<wrappedDek b64>:<iv b64>:<authTag b64>:<ciphertext b64>
 *
 * The `enc:v1:` prefix makes encrypted values self-describing, so plaintext rows
 * written before this change keep working and can be migrated lazily. The
 * version segment is what makes key rotation possible without a flag day.
 *
 * MODES
 *
 *   POSTIZ_KMS_KEY_NAME set  -> KMS envelope encryption (production)
 *   POSTIZ_TOKEN_ENCRYPTION_KEY set -> local AES-256-GCM with a static key,
 *                                      for development and CI where KMS
 *                                      credentials are not available
 *   neither                  -> passthrough, matching upstream behaviour, with a
 *                              loud warning. This fork is public and must remain
 *                              runnable by anyone who is not on GCP.
 *
 * In production (NODE_ENV=production) passthrough is refused outright — silently
 * storing plaintext because an env var was missed is precisely the failure this
 * module exists to prevent.
 */

import * as crypto from 'crypto';

const PREFIX = 'enc';
const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const DEK_BYTES = 32;
const IV_BYTES = 12; // 96-bit nonce, the recommended size for GCM

type KmsClient = {
  encrypt(request: {
    name: string;
    plaintext: Buffer;
  }): Promise<[{ ciphertext?: Uint8Array | string | null }, ...unknown[]]>;
  decrypt(request: {
    name: string;
    ciphertext: Buffer;
  }): Promise<[{ plaintext?: Uint8Array | string | null }, ...unknown[]]>;
};

let kmsClient: KmsClient | undefined;
let warnedAboutPassthrough = false;

/**
 * Small cache of unwrapped DEKs, keyed by the wrapped DEK.
 *
 * Reads outnumber writes heavily — a single publish loads the integration, and
 * listings load many at once — so without this every read would be a network
 * round trip to KMS. Cached only in memory, never persisted, and bounded so a
 * long-running process cannot grow unboundedly.
 */
const dekCache = new Map<string, Buffer>();
const DEK_CACHE_MAX = 500;

function cacheDek(wrapped: string, dek: Buffer) {
  if (dekCache.size >= DEK_CACHE_MAX) {
    // Cheapest useful eviction: drop the oldest insertion. Map preserves order.
    const oldest = dekCache.keys().next().value;
    if (oldest !== undefined) {
      dekCache.delete(oldest);
    }
  }
  dekCache.set(wrapped, dek);
}

function getKmsKeyName(): string | undefined {
  return process.env.POSTIZ_KMS_KEY_NAME || undefined;
}

function getLocalKey(): Buffer | undefined {
  const raw = process.env.POSTIZ_TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    return undefined;
  }

  // Accept hex or base64; reject anything that is not exactly 256 bits, because
  // a short key here would silently weaken every token in the database.
  const buf = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');

  if (buf.length !== DEK_BYTES) {
    throw new Error(
      `[primuspost] POSTIZ_TOKEN_ENCRYPTION_KEY must be 32 bytes (got ${buf.length}). ` +
        `Generate one with: openssl rand -hex 32`
    );
  }

  return buf;
}

async function getKmsClient(): Promise<KmsClient> {
  if (!kmsClient) {
    // Imported lazily so deployments that do not use KMS are not forced to
    // install or load the client library.
    const { KeyManagementServiceClient } = await import('@google-cloud/kms');
    kmsClient = new KeyManagementServiceClient() as unknown as KmsClient;
  }
  return kmsClient;
}

function isEncryptionConfigured(): boolean {
  return Boolean(getKmsKeyName() || process.env.POSTIZ_TOKEN_ENCRYPTION_KEY);
}

function warnPassthroughOnce() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[primuspost] Refusing to store social tokens in plaintext in production. ' +
        'Set POSTIZ_KMS_KEY_NAME (recommended) or POSTIZ_TOKEN_ENCRYPTION_KEY.'
    );
  }
  if (!warnedAboutPassthrough) {
    warnedAboutPassthrough = true;
    console.warn(
      '[primuspost] Token encryption is NOT configured — social tokens will be ' +
        'stored in plaintext. Acceptable for local development only.'
    );
  }
}

/** True when the value carries our envelope, i.e. is already encrypted. */
export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(`${PREFIX}:${VERSION}:`);
}

async function wrapDek(dek: Buffer): Promise<string> {
  const keyName = getKmsKeyName();

  if (keyName) {
    const client = await getKmsClient();
    const [result] = await client.encrypt({ name: keyName, plaintext: dek });
    if (!result?.ciphertext) {
      throw new Error('[primuspost] KMS returned no ciphertext when wrapping DEK');
    }
    return Buffer.from(result.ciphertext as Uint8Array).toString('base64');
  }

  // Local mode: "wrap" by encrypting the DEK with the static key, so the stored
  // format is identical in both modes and a database written in one mode is
  // structurally readable by the other given the right key material.
  const localKey = getLocalKey();
  if (!localKey) {
    throw new Error('[primuspost] no encryption key configured');
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, localKey, iv);
  const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `local.${iv.toString('base64')}.${tag.toString('base64')}.${wrapped.toString('base64')}`;
}

async function unwrapDek(wrapped: string): Promise<Buffer> {
  const cached = dekCache.get(wrapped);
  if (cached) {
    return cached;
  }

  let dek: Buffer;

  if (wrapped.startsWith('local.')) {
    const localKey = getLocalKey();
    if (!localKey) {
      throw new Error(
        '[primuspost] value was encrypted with a local key but POSTIZ_TOKEN_ENCRYPTION_KEY is not set'
      );
    }
    const [, ivB64, tagB64, dataB64] = wrapped.split('.');
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      localKey,
      Buffer.from(ivB64, 'base64')
    );
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    dek = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);
  } else {
    const keyName = getKmsKeyName();
    if (!keyName) {
      throw new Error(
        '[primuspost] value was encrypted with KMS but POSTIZ_KMS_KEY_NAME is not set'
      );
    }
    const client = await getKmsClient();
    const [result] = await client.decrypt({
      name: keyName,
      ciphertext: Buffer.from(wrapped, 'base64'),
    });
    if (!result?.plaintext) {
      throw new Error('[primuspost] KMS returned no plaintext when unwrapping DEK');
    }
    dek = Buffer.from(result.plaintext as Uint8Array);
  }

  cacheDek(wrapped, dek);
  return dek;
}

/**
 * Encrypt a token for storage. Returns the value unchanged when it is empty or
 * already encrypted, so this is safe to apply to every write including updates
 * that do not touch the token.
 */
export async function encryptToken(value: unknown): Promise<unknown> {
  if (typeof value !== 'string' || value.length === 0) {
    return value;
  }

  if (isEncrypted(value)) {
    return value;
  }

  if (!isEncryptionConfigured()) {
    warnPassthroughOnce();
    return value;
  }

  const dek = crypto.randomBytes(DEK_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, dek, iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const wrappedDek = await wrapDek(dek);

  return [
    PREFIX,
    VERSION,
    wrappedDek,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}

/**
 * Decrypt a stored token.
 *
 * Values without our prefix are returned unchanged — that is how rows written
 * before this change keep working, and how a vanilla deployment stays
 * functional.
 *
 * FAILS CLOSED. If a value IS ours but cannot be decrypted — wrong key, rotated
 * KEK, revoked permission, corrupted row — this throws rather than returning the
 * ciphertext. Returning it would hand an unusable string to a social provider,
 * which would surface as a confusing auth error against LinkedIn instead of an
 * obvious local failure, and could leak ciphertext into third-party logs.
 */
export async function decryptToken(value: unknown): Promise<unknown> {
  if (!isEncrypted(value)) {
    return value;
  }

  const parts = value.split(':');
  if (parts.length !== 6) {
    throw new Error('[primuspost] malformed encrypted token: unexpected segment count');
  }

  const [, , wrappedDek, ivB64, tagB64, dataB64] = parts;

  const dek = await unwrapDek(wrappedDek);
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    dek,
    Buffer.from(ivB64, 'base64')
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}

/** Fields on Integration that hold credentials and must never rest in plaintext. */
export const ENCRYPTED_INTEGRATION_FIELDS = ['token', 'refreshToken'] as const;
