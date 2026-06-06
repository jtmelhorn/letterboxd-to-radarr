import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { getDataDir } from "@/app/lib/config";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const ENCRYPTED_PREFIX = "enc:v1:";

let cachedKey: Buffer | null = null;

function parseKeyFromEnv(raw: string): Buffer | null {
  const value = raw.trim();
  if (!value) return null;

  // Accept base64 or hex encoded 32-byte keys.
  const candidates: Buffer[] = [];
  try {
    candidates.push(Buffer.from(value, "base64"));
  } catch {
    // ignore
  }
  if (/^[0-9a-fA-F]+$/.test(value)) {
    candidates.push(Buffer.from(value, "hex"));
  }

  const match = candidates.find((buf) => buf.length === KEY_LENGTH);
  return match ?? null;
}

/**
 * Resolve the master encryption key. Priority:
 *   1. APP_ENCRYPTION_KEY env (base64 or hex, 32 bytes)
 *   2. A persisted random keyfile in the data dir (zero-config, stable across
 *      restarts as long as the volume persists).
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const fromEnv = parseKeyFromEnv(process.env.APP_ENCRYPTION_KEY ?? "");
  if (fromEnv) {
    cachedKey = fromEnv;
    return cachedKey;
  }

  const dataDir = getDataDir();
  const keyPath = path.join(dataDir, "secret.key");

  try {
    if (existsSync(keyPath)) {
      const stored = parseKeyFromEnv(readFileSync(keyPath, "utf8"));
      if (stored) {
        cachedKey = stored;
        return cachedKey;
      }
    }

    mkdirSync(dataDir, { recursive: true });
    const generated = randomBytes(KEY_LENGTH);
    writeFileSync(keyPath, generated.toString("base64"), "utf8");
    try {
      chmodSync(keyPath, 0o600);
    } catch {
      // best effort on platforms without POSIX perms
    }
    cachedKey = generated;
    return cachedKey;
  } catch {
    // Last resort: ephemeral key. Data encrypted with it will not survive a
    // restart, but the app keeps working.
    cachedKey = randomBytes(KEY_LENGTH);
    return cachedKey;
  }
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return "";

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return (
    ENCRYPTED_PREFIX +
    [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(":")
  );
}

export function decryptSecret(value: string): string {
  if (!value) return "";

  // Backward compatibility: values stored before encryption was introduced are
  // returned as-is.
  if (!isEncrypted(value)) {
    return value;
  }

  try {
    const [, , ivPart, tagPart, dataPart] = value.split(":");
    const iv = Buffer.from(ivPart, "base64");
    const authTag = Buffer.from(tagPart, "base64");
    const ciphertext = Buffer.from(dataPart, "base64");

    const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return "";
  }
}

/** HMAC-SHA256 signing for session cookies, keyed by the master secret. */
export function sign(payload: string): string {
  return createHmac("sha256", getKey()).update(payload).digest("base64url");
}

export function verifySignature(payload: string, signature: string): boolean {
  const expected = sign(payload);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const PASSWORD_SCRYPT_PREFIX = "scrypt:v1:";
const PASSWORD_SALT_LENGTH = 16;
const PASSWORD_KEY_LENGTH = 32;

/** Hash a plaintext password for storage in app_state.admin_password_hash. */
export function hashPassword(plaintext: string): string {
  const salt = randomBytes(PASSWORD_SALT_LENGTH);
  const derived = scryptSync(plaintext, salt, PASSWORD_KEY_LENGTH);
  return `${PASSWORD_SCRYPT_PREFIX}${salt.toString("base64")}:${derived.toString("base64")}`;
}

/** Verify a plaintext password against a stored scrypt hash. */
export function verifyPasswordHash(plaintext: string, storedHash: string): boolean {
  if (!storedHash.startsWith(PASSWORD_SCRYPT_PREFIX)) return false;

  const payload = storedHash.slice(PASSWORD_SCRYPT_PREFIX.length);
  const sep = payload.indexOf(":");
  if (sep <= 0) return false;

  const salt = Buffer.from(payload.slice(0, sep), "base64");
  const expected = Buffer.from(payload.slice(sep + 1), "base64");
  if (expected.length !== PASSWORD_KEY_LENGTH) return false;

  const derived = scryptSync(plaintext, salt, PASSWORD_KEY_LENGTH);
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
