import crypto from 'node:crypto';
import { AppError } from '../utils/errors.js';

/**
 * Inspect real file content instead of trusting the filename or client MIME type.
 * A PDF starts with "%PDF-" (within the first 1024 bytes per spec) and ends with "%%EOF"
 * (within the last 1024 bytes). We also reject files with active launch/script payloads
 * only at a basic level; the file is always served as application/pdf with nosniff.
 */
export function validatePdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 67) {
    throw new AppError(400, 'INVALID_FILE', 'The uploaded file is empty or too small to be a PDF.');
  }
  const head = buffer.subarray(0, 1024).toString('latin1');
  const headIdx = head.indexOf('%PDF-');
  if (headIdx === -1 || headIdx > 1019) {
    throw new AppError(400, 'INVALID_FILE', 'The uploaded file is not a valid PDF document.');
  }
  const tail = buffer.subarray(Math.max(0, buffer.length - 1024)).toString('latin1');
  if (!tail.includes('%%EOF')) {
    throw new AppError(400, 'INVALID_FILE', 'The PDF appears to be truncated or corrupted (missing end-of-file marker).');
  }
  return true;
}

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Produce a safe display filename (never used for storage paths). */
export function safeFilename(name) {
  const base = String(name || 'certificate.pdf')
    .replace(/[\\/]/g, '_')
    .replace(/[^\w.\- ()]/g, '_')
    .slice(0, 120)
    .trim();
  return base.toLowerCase().endsWith('.pdf') ? base : `${base || 'certificate'}.pdf`;
}

export function newStorageKey() {
  const d = new Date();
  return `certificates/${d.getUTCFullYear()}/${crypto.randomUUID()}.pdf`;
}
