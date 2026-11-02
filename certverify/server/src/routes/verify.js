import { Router } from 'express';
import config from '../config/env.js';
import Certificate from '../models/Certificate.js';
import { dbReady } from '../config/db.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import { verifyLimiter } from '../middleware/security.js';
import { streamPdf } from '../services/pdfStream.js';

const router = Router();
router.use(verifyLimiter);

// Never let intermediaries cache a verification result: status can change at any time.
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

async function lookup(rawId) {
  if (!dbReady()) throw new AppError(503, 'SERVICE_UNAVAILABLE', 'The verification service is temporarily unavailable.');
  const identifier = String(rawId || '');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(identifier)) {
    throw new AppError(404, 'CERTIFICATE_NOT_FOUND', 'No matching official record was found.');
  }
  let cert;
  try {
    cert = await Certificate.findOne({ verificationToken: identifier, archivedAt: null });
    if (!cert) {
      cert = await Certificate.findOne({
        certificateId: identifier.toUpperCase(),
        verificationToken: { $exists: false },
        archivedAt: null,
      });
    }
  } catch {
    throw new AppError(503, 'SERVICE_UNAVAILABLE', 'The verification service is temporarily unavailable.');
  }
  if (!cert) throw new AppError(404, 'CERTIFICATE_NOT_FOUND', 'No matching official record was found.');
  return cert;
}

const pdfAllowed = (cert) => cert.status === 'valid' || config.ALLOW_PUBLIC_PDF_WHEN_REVOKED;

// Minimum information needed to verify – no internal IDs, storage keys, notes or admin info.
router.get(
  '/:certificateId',
  asyncHandler(async (req, res) => {
    const cert = await lookup(req.params.certificateId);
    res.json({
      certificateId: cert.certificateId,
      status: cert.status,
      studentName: cert.studentName,
      course: cert.course,
      institution: cert.institution,
      issueDate: cert.issueDate,
      graduationDate: cert.graduationDate,
      academicYear: cert.academicYear,
      revokedAt: cert.status === 'revoked' ? cert.revokedAt : null,
      pdfAvailable: pdfAllowed(cert),
      pdfContainsQr: Boolean(cert.pdfFinalStorageKey),
      downloadAllowed: config.ALLOW_PUBLIC_DOWNLOAD && pdfAllowed(cert),
      checkedAt: new Date().toISOString(),
    });
  })
);

router.get(
  '/:certificateId/pdf',
  asyncHandler(async (req, res) => {
    const cert = await lookup(req.params.certificateId);
    if (!pdfAllowed(cert)) {
      throw new AppError(403, 'PDF_NOT_AVAILABLE', 'The PDF for this certificate is not available.');
    }
    const wantsDownload = req.query.download === '1' || req.query.download === 'true';
    if (wantsDownload && !config.ALLOW_PUBLIC_DOWNLOAD) {
      throw new AppError(403, 'DOWNLOAD_DISABLED', 'Downloads are disabled by the issuing institution. You can still view the PDF online.');
    }
    await streamPdf(res, cert, { download: wantsDownload });
  })
);

export default router;
