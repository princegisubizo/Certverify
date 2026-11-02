import crypto from 'node:crypto';

// Unambiguous alphabet (no 0/O/1/I) so IDs survive being read aloud or typed.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomChars(n) {
  const bytes = crypto.randomBytes(n);
  let out = '';
  for (let i = 0; i < n; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

/** System-generated ID, e.g. CERT-2026-K7M2QX9P (cryptographically random, ~40 bits). */
export function generateCertificateId(date = new Date()) {
  return `CERT-${date.getUTCFullYear()}-${randomChars(8)}`;
}

/** Public verification tokens are independent of potentially enumerable institution IDs. */
export function generateVerificationToken() {
  return crypto.randomBytes(32).toString('base64url');
}

// Institution-assigned numbers become the public ID after normalisation.
// Allowed: letters, digits, dot, underscore, hyphen. No slashes/spaces so URLs stay clean.
const ID_PATTERN = /^[A-Z0-9][A-Z0-9._-]{2,63}$/;

export function normalizeCertificateNumber(input) {
  return String(input || '').trim().toUpperCase().replace(/\s+/g, '-');
}

export function isValidCertificateId(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}
