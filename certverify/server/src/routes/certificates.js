import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import config from '../config/env.js';
import Certificate from '../models/Certificate.js';
import AuditLog from '../models/AuditLog.js';
import { AppError, asyncHandler } from '../utils/errors.js';
import { requireAdmin } from '../middleware/auth.js';
import { generateCertificateId, generateVerificationToken, isValidCertificateId, normalizeCertificateNumber } from '../utils/ids.js';
import { newStorageKey, safeFilename, sha256, validatePdfBuffer } from '../services/pdf.js';
import { embedQrInPdf } from '../services/pdfEmbed.js';
import { getStorage } from '../services/storage.js';
import { qrPng, qrSvg, verificationUrl } from '../services/qr.js';
import { streamPdf } from '../services/pdfStream.js';
import { audit } from '../services/audit.js';

const router = Router();
router.use(requireAdmin);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 20 },
});

/* ---------- validation ---------- */

// Strip control characters and collapse whitespace.
const clean = (s) => s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const text = (label, max, required = true) => {
  const base = z.string({ required_error: `${label} is required.` }).transform(clean);
  return required
    ? base.pipe(z.string().min(1, `${label} is required.`).max(max, `${label} must be at most ${max} characters.`))
    : base.pipe(z.string().max(max, `${label} must be at most ${max} characters.`)).optional().default('');
};
const dateField = (label, required = true) => {
  const parsed = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a date (YYYY-MM-DD).`)
    .refine((v) => !Number.isNaN(Date.parse(v)), `${label} is not a valid date.`)
    .transform((v) => new Date(`${v}T00:00:00.000Z`));
  return required
    ? z.string({ required_error: `${label} is required.` }).pipe(parsed)
    : z.preprocess((v) => (v === '' || v == null ? undefined : v), parsed.optional());
};

const metadataShape = {
  studentName: text("Student's full name", 200),
  course: text('Course / qualification', 250),
  institution: text('Issuing institution', 250),
  issueDate: dateField('Issue date'),
  graduationDate: dateField('Graduation date', false),
  department: text('Department', 200, false),
  academicYear: text('Academic year', 40, false),
  notes: text('Notes', 2000, false),
};

const createSchema = z.object({
  certificateNumber: z.string().optional().default(''),
  ...metadataShape,
  confirmDuplicate: z.enum(['true', 'false']).optional().default('false'),
});

const updateSchema = z.object(metadataShape).partial().strict();

const statusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('valid') }),
  z.object({
    status: z.literal('revoked'),
    reason: z
      .string({ required_error: 'A reason is required to revoke a certificate.' })
      .transform(clean)
      .pipe(z.string().min(3, 'A reason is required to revoke a certificate.').max(1000)),
  }),
]);

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  q: z.string().trim().max(100).optional().default(''),
  status: z.enum(['valid', 'revoked', '']).optional().default(''),
  issueFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  issueTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
  sort: z.enum(['createdAt', 'issueDate', 'studentName']).optional().default('createdAt'),
  order: z.enum(['asc', 'desc']).optional().default('desc'),
  includeArchived: z.enum(['true', 'false']).optional().default('false'),
});

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ---------- helpers ---------- */

export function adminView(c) {
  return {
    certificateId: c.certificateId,
    certificateNumberSupplied: c.certificateNumberSupplied,
    studentName: c.studentName,
    course: c.course,
    institution: c.institution,
    issueDate: c.issueDate,
    graduationDate: c.graduationDate,
    department: c.department,
    academicYear: c.academicYear,
    notes: c.notes,
    pdfOriginalFilename: c.pdfOriginalFilename,
    pdfContentType: c.pdfContentType,
    pdfSize: c.pdfSize,
    pdfChecksum: c.pdfChecksum,
    pdfFinalSize: c.pdfFinalSize,
    pdfFinalChecksum: c.pdfFinalChecksum,
    pdfQrPage: c.pdfQrPage,
    pdfQrCorner: c.pdfQrCorner,
    pdfContainsQr: Boolean(c.pdfFinalStorageKey),
    status: c.status,
    revokedAt: c.revokedAt,
    revocationReason: c.revocationReason,
    archivedAt: c.archivedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    verificationUrl: verificationUrl(c.verificationToken || c.certificateId),
  };
}

async function findOr404(certificateId) {
  const cert = await Certificate.findOne({ certificateId: String(certificateId).toUpperCase() });
  if (!cert) throw new AppError(404, 'CERTIFICATE_NOT_FOUND', 'Certificate not found.');
  return cert;
}

function requirePdfFile(req) {
  if (!req.file) throw new AppError(400, 'VALIDATION_ERROR', 'A certificate PDF file is required.', { pdf: 'A certificate PDF file is required.' });
  const name = req.file.originalname || '';
  if (!/\.pdf$/i.test(name)) {
    throw new AppError(400, 'INVALID_FILE', 'Only PDF files (.pdf) are accepted.', { pdf: 'Only PDF files (.pdf) are accepted.' });
  }
  validatePdfBuffer(req.file.buffer); // inspects real content, not the extension
}

const uploadOne = (req, res, next) =>
  upload.single('pdf')(req, res, (err) => {
    if (err) return next(err);
    next();
  });

async function cleanupStoredKeys(storage, keys, context) {
  await Promise.all(
    keys.filter(Boolean).map(async (key) => {
      try {
        await storage.remove(key);
      } catch (error) {
        console.error(`[storage] could not clean up ${context}`, error.message);
      }
    })
  );
}

/* ---------- routes ---------- */

// Dashboard statistics (must be registered before "/:id").
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const active = { archivedAt: null };
    const [total, valid, revoked, recent] = await Promise.all([
      Certificate.countDocuments(active),
      Certificate.countDocuments({ ...active, status: 'valid' }),
      Certificate.countDocuments({ ...active, status: 'revoked' }),
      Certificate.find(active).sort({ createdAt: -1 }).limit(5),
    ]);
    res.json({ total, valid, revoked, recent: recent.map(adminView) });
  })
);

// Upload + register.
router.post(
  '/',
  uploadOne,
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    requirePdfFile(req);

    // Resolve the public identifier.
    let certificateId;
    let supplied = false;
    const rawNumber = body.certificateNumber.trim();
    if (rawNumber) {
      certificateId = normalizeCertificateNumber(rawNumber);
      if (!isValidCertificateId(certificateId)) {
        throw new AppError(400, 'VALIDATION_ERROR', 'Invalid certificate number.', {
          certificateNumber: 'Use 3–64 letters, numbers, dots, hyphens or underscores (no slashes).',
        });
      }
      if (await Certificate.exists({ certificateId })) {
        throw new AppError(409, 'DUPLICATE_CERTIFICATE_NUMBER', `Certificate number ${certificateId} is already registered.`, {
          certificateNumber: 'This certificate number is already registered.',
        });
      }
      supplied = true;
    }

    // Same student + course + issue date is very likely a double upload.
    if (body.confirmDuplicate !== 'true') {
      const dup = await Certificate.findOne({
        studentName: new RegExp(`^${escapeRegex(body.studentName)}$`, 'i'),
        course: new RegExp(`^${escapeRegex(body.course)}$`, 'i'),
        issueDate: body.issueDate,
        archivedAt: null,
      });
      if (dup) {
        throw new AppError(409, 'DUPLICATE_RECORD', `A certificate for this student, course and issue date already exists (${dup.certificateId}).`, {
          existingCertificateId: dup.certificateId,
        });
      }
    }

    const buffer = req.file.buffer;
    const checksum = sha256(buffer);
    const originalStorageKey = newStorageKey();
    const storage = getStorage();

    // Keep the uploaded bytes unchanged and store the QR-embedded printable PDF separately.
    let cert;
    let finalStorageKey = null;
    try {
      await storage.put(originalStorageKey, buffer, 'application/pdf');
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = supplied ? certificateId : generateCertificateId();
        const verificationToken = generateVerificationToken();
        const finalBuffer = await embedQrInPdf(buffer, await qrPng(verificationToken));
        const finalChecksum = sha256(finalBuffer);
        finalStorageKey = newStorageKey();
        await storage.put(finalStorageKey, finalBuffer, 'application/pdf');
        try {
          cert = await Certificate.create({
            certificateId: id,
            verificationToken,
            certificateNumberSupplied: supplied,
            studentName: body.studentName,
            course: body.course,
            institution: body.institution,
            issueDate: body.issueDate,
            graduationDate: body.graduationDate ?? null,
            department: body.department,
            academicYear: body.academicYear,
            notes: body.notes,
            pdfStorageKey: originalStorageKey,
            pdfFinalStorageKey: finalStorageKey,
            pdfOriginalFilename: safeFilename(req.file.originalname),
            pdfContentType: 'application/pdf',
            pdfSize: buffer.length,
            pdfChecksum: checksum,
            pdfFinalSize: finalBuffer.length,
            pdfFinalChecksum: finalChecksum,
            pdfQrPage: config.PDF_QR_PAGE,
            pdfQrCorner: config.PDF_QR_CORNER,
            createdBy: req.admin._id,
          });
          finalStorageKey = null;
          break;
        } catch (e) {
          if (e?.code === 11000 && e.keyPattern?.verificationToken) {
            await storage.remove(finalStorageKey);
            finalStorageKey = null;
            continue;
          }
          if (e?.code === 11000 && !supplied) {
            await storage.remove(finalStorageKey);
            finalStorageKey = null;
            continue; // ID collision – retry with a new random ID
          }
          if (e?.code === 11000) {
            throw new AppError(409, 'DUPLICATE_CERTIFICATE_NUMBER', `Certificate number ${certificateId} is already registered.`, {
              certificateNumber: 'This certificate number is already registered.',
            });
          }
          throw e;
        }
      }
      if (!cert) throw new Error('Could not allocate a unique certificate ID');
    } catch (e) {
      await cleanupStoredKeys(storage, [originalStorageKey, finalStorageKey], 'an incomplete certificate upload');
      throw e;
    }

    await audit(req, 'certificate.create', cert.certificateId, { checksum, filename: cert.pdfOriginalFilename });
    res.status(201).json({ certificate: adminView(cert) });
  })
);

// Paginated, searchable listing.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const p = listSchema.parse(req.query);
    const filter = {};
    if (p.includeArchived !== 'true') filter.archivedAt = null;
    if (p.status) filter.status = p.status;
    if (p.issueFrom || p.issueTo) {
      filter.issueDate = {};
      if (p.issueFrom) filter.issueDate.$gte = new Date(`${p.issueFrom}T00:00:00.000Z`);
      if (p.issueTo) filter.issueDate.$lte = new Date(`${p.issueTo}T23:59:59.999Z`);
    }
    if (p.q) {
      const rx = new RegExp(escapeRegex(p.q), 'i');
      filter.$or = ['studentName', 'certificateId', 'course', 'institution', 'department', 'academicYear'].map((f) => ({ [f]: rx }));
    }
    const sort = { [p.sort]: p.order === 'asc' ? 1 : -1, _id: -1 };
    const [items, total] = await Promise.all([
      Certificate.find(filter).sort(sort).skip((p.page - 1) * p.limit).limit(p.limit),
      Certificate.countDocuments(filter),
    ]);
    res.json({
      items: items.map(adminView),
      page: p.page,
      limit: p.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / p.limit)),
    });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json({ certificate: adminView(await findOr404(req.params.id)) });
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const cert = await findOr404(req.params.id);
    const changes = updateSchema.parse(req.body);
    const before = {};
    for (const [k, v] of Object.entries(changes)) {
      if (v === undefined) continue;
      before[k] = cert[k];
      cert[k] = v;
    }
    await cert.save();
    await audit(req, 'certificate.update', cert.certificateId, { before, after: changes });
    res.json({ certificate: adminView(cert) });
  })
);

router.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const cert = await findOr404(req.params.id);
    const body = statusSchema.parse(req.body);
    if (body.status === 'revoked') {
      cert.status = 'revoked';
      cert.revokedAt = new Date();
      cert.revocationReason = body.reason;
    } else {
      cert.status = 'valid';
      cert.revokedAt = null;
      cert.revocationReason = '';
    }
    await cert.save();
    await audit(req, body.status === 'revoked' ? 'certificate.revoke' : 'certificate.restore', cert.certificateId, {
      reason: body.reason || '',
    });
    res.json({ certificate: adminView(cert) });
  })
);

router.post(
  '/:id/pdf/regenerate',
  asyncHandler(async (req, res) => {
    const cert = await findOr404(req.params.id);
    const storage = getStorage();
    let originalBuffer;
    try {
      const { stream } = await storage.getStream(cert.pdfStorageKey);
      const chunks = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      originalBuffer = Buffer.concat(chunks);
    } catch (error) {
      console.error('[storage] failed to read original PDF for regeneration', cert.certificateId, error.code || error.name);
      throw new AppError(503, 'PDF_UNAVAILABLE', 'The original PDF could not be retrieved right now. Please try again shortly.');
    }

    const verificationId = cert.verificationToken || cert.certificateId;
    const printablePdf = await embedQrInPdf(originalBuffer, await qrPng(verificationId));
    const newFinalStorageKey = newStorageKey();
    try {
      await storage.put(newFinalStorageKey, printablePdf, 'application/pdf');
      const oldFinalStorageKey = cert.pdfFinalStorageKey;
      cert.pdfFinalStorageKey = newFinalStorageKey;
      cert.pdfFinalSize = printablePdf.length;
      cert.pdfFinalChecksum = sha256(printablePdf);
      cert.pdfQrPage = config.PDF_QR_PAGE;
      cert.pdfQrCorner = config.PDF_QR_CORNER;
      await cert.save();
      await cleanupStoredKeys(storage, [oldFinalStorageKey], 'the regenerated printable PDF');
    } catch (error) {
      await cleanupStoredKeys(storage, [newFinalStorageKey], 'a failed PDF regeneration');
      throw error;
    }

    await audit(req, 'certificate.regenerate_pdf', cert.certificateId, {
      checksum: cert.pdfFinalChecksum,
      filename: cert.pdfOriginalFilename,
    });
    res.json({ certificate: adminView(cert) });
  })
);

// Replace the source and printable PDF while keeping the same certificate ID / QR code.
router.post(
  '/:id/pdf',
  uploadOne,
  asyncHandler(async (req, res) => {
    const cert = await findOr404(req.params.id);
    if (req.body?.confirm !== 'true') {
      throw new AppError(400, 'CONFIRMATION_REQUIRED', 'Confirm that you want to replace the PDF for this certificate.');
    }
    requirePdfFile(req);
    const buffer = req.file.buffer;
    const checksum = sha256(buffer);
    const storage = getStorage();
    const newOriginalKey = newStorageKey();
    const qrEmbeddedPdf = await embedQrInPdf(buffer, await qrPng(cert.verificationToken || cert.certificateId));
    const finalChecksum = sha256(qrEmbeddedPdf);
    const newFinalKey = newStorageKey();
    const old = {
      originalKey: cert.pdfStorageKey,
      finalKey: cert.pdfFinalStorageKey,
      checksum: cert.pdfChecksum,
      filename: cert.pdfOriginalFilename,
    };

    try {
      await storage.put(newOriginalKey, buffer, 'application/pdf');
      await storage.put(newFinalKey, qrEmbeddedPdf, 'application/pdf');
      cert.pdfStorageKey = newOriginalKey;
      cert.pdfFinalStorageKey = newFinalKey;
      cert.pdfOriginalFilename = safeFilename(req.file.originalname);
      cert.pdfSize = buffer.length;
      cert.pdfChecksum = checksum;
      cert.pdfFinalSize = qrEmbeddedPdf.length;
      cert.pdfFinalChecksum = finalChecksum;
      cert.pdfQrPage = config.PDF_QR_PAGE;
      cert.pdfQrCorner = config.PDF_QR_CORNER;
      await cert.save();
    } catch (e) {
      await cleanupStoredKeys(storage, [newOriginalKey, newFinalKey], 'a failed PDF replacement');
      throw e;
    }
    await cleanupStoredKeys(storage, [old.originalKey, old.finalKey], 'the replaced PDF');
    await audit(req, 'certificate.replace_pdf', cert.certificateId, {
      oldChecksum: old.checksum,
      newChecksum: checksum,
      newFinalChecksum: finalChecksum,
      oldFilename: old.filename,
      newFilename: cert.pdfOriginalFilename,
    });
    res.json({ certificate: adminView(cert) });
  })
);

router.get(
  '/:id/qr',
  asyncHandler(async (req, res) => {
    const cert = await findOr404(req.params.id);
    const format = req.query.format === 'svg' ? 'svg' : 'png';
    const download = req.query.download === '1' || req.query.download === 'true';
    const disp = download ? `attachment; filename="qr-${cert.certificateId}.${format}"` : 'inline';
    res.setHeader('Content-Disposition', disp);
    res.setHeader('Cache-Control', 'private, no-cache');
    if (format === 'svg') {
      res.type('image/svg+xml').send(await qrSvg(cert.verificationToken || cert.certificateId));
    } else {
      res.type('image/png').send(await qrPng(cert.verificationToken || cert.certificateId));
    }
  })
);

router.get(
  '/:id/pdf',
  asyncHandler(async (req, res) => {
    const cert = await findOr404(req.params.id);
    await streamPdf(res, cert, { download: req.query.download === '1' || req.query.download === 'true' });
  })
);

router.get(
  '/:id/original-pdf',
  asyncHandler(async (req, res) => {
    const cert = await findOr404(req.params.id);
    await streamPdf(res, cert, {
      download: req.query.download === '1' || req.query.download === 'true',
      original: true,
    });
  })
);

router.get(
  '/:id/audit',
  asyncHandler(async (req, res) => {
    const cert = await findOr404(req.params.id);
    const logs = await AuditLog.find({ certificateId: cert.certificateId }).sort({ createdAt: -1 }).limit(100);
    res.json({
      items: logs.map((l) => ({ action: l.action, actorEmail: l.actorEmail, details: l.details, createdAt: l.createdAt })),
    });
  })
);

// Controlled retention: records are archived (hidden, no longer verifiable) rather than hard-deleted.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const cert = await findOr404(req.params.id);
    if (req.query.confirm !== 'true') {
      throw new AppError(400, 'CONFIRMATION_REQUIRED', 'Confirmation required to archive a certificate.');
    }
    cert.archivedAt = new Date();
    await cert.save();
    await audit(req, 'certificate.archive', cert.certificateId);
    res.json({ ok: true });
  })
);

export default router;
