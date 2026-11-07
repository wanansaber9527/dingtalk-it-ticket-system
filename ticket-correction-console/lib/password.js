import crypto from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(crypto.scrypt);
const FORMAT = "scrypt-v1";
const DEFAULTS = {
  N: 16384,
  r: 8,
  p: 1,
  keyLength: 64
};

export async function hashPassword(password, salt = crypto.randomBytes(16), options = {}) {
  const N = options.N || DEFAULTS.N;
  const r = options.r || DEFAULTS.r;
  const p = options.p || DEFAULTS.p;
  const derived = await scryptAsync(password, salt, DEFAULTS.keyLength, {
    N,
    r,
    p,
    maxmem: 64 * 1024 * 1024
  });
  return [
    FORMAT,
    String(N),
    String(r),
    String(p),
    Buffer.from(salt).toString("base64url"),
    Buffer.from(derived).toString("base64url")
  ].join("$");
}

export async function verifyPassword(password, encoded) {
  if (typeof encoded !== "string") return false;
  const [format, nText, rText, pText, saltText, hashText, ...extra] = encoded.split("$");
  if (format !== FORMAT || !nText || !rText || !pText || !saltText || !hashText || extra.length) {
    return false;
  }

  const N = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
  if (N < 16384 || N > 262144 || r < 8 || r > 32 || p < 1 || p > 8) return false;

  try {
    const expected = Buffer.from(hashText, "base64url");
    const actual = await scryptAsync(password, Buffer.from(saltText, "base64url"), expected.length, {
      N,
      r,
      p,
      maxmem: 128 * 1024 * 1024
    });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
