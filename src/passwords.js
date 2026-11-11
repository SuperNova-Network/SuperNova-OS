/*
 * Password hashing (scrypt). Shared by the accounts and the admin API.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

// scrypt cost: about 50 ms and 32 MB per hash. Hashing runs off the main thread.
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function checkPassword(password, stored) {
  const [scheme, N, r, p, salt, expected] = String(stored).split("$");
  if (scheme !== "scrypt") return false;
  const want = Buffer.from(expected, "base64");
  const key = await scrypt(password.normalize("NFKC"), Buffer.from(salt, "base64"), want.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  });
  return key.length === want.length && timingSafeEqual(key, want);
}
