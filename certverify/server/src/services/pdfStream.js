import config from '../config/env.js';
import { getStorage } from './storage.js';
import { AppError } from '../utils/errors.js';

/** Streams either the QR-embedded printable PDF or the preserved original upload. */
export async function streamPdf(res, cert, { download = false, original = false } = {}) {
  const storageKey = original ? cert.pdfStorageKey : cert.pdfFinalStorageKey || cert.pdfStorageKey;
  const checksum = original ? cert.pdfChecksum : cert.pdfFinalChecksum || cert.pdfChecksum;
  let result;
  try {
    result = await getStorage().getStream(storageKey);
  } catch (e) {
    console.error('[storage] failed to read PDF', cert.certificateId, e.code || e.name);
    throw new AppError(503, 'PDF_UNAVAILABLE', 'The PDF could not be retrieved right now. Please try again shortly.');
  }
  const filename = `${cert.certificateId}.pdf`;
  res.status(200);
  res.setHeader('Content-Type', 'application/pdf');
  if (result.size) res.setHeader('Content-Length', String(result.size));
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('ETag', `"${checksum}"`);
  // Allow our own front end (possibly on another origin) to embed the PDF in an <iframe>.
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', `default-src 'none'; frame-ancestors 'self' ${config.CLIENT_URL}`);
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  result.stream.on('error', () => res.destroy());
  result.stream.pipe(res);
}
