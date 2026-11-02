import mongoose from 'mongoose';

const certificateSchema = new mongoose.Schema(
  {
    // Permanent institution-facing certificate identifier.
    certificateId: { type: String, required: true, unique: true, index: true, maxlength: 64 },
    // High-entropy public route token prevents enumeration when the institution ID is sequential.
    verificationToken: { type: String, unique: true, sparse: true, maxlength: 64 },
    // True when the institution supplied its own certificate number.
    certificateNumberSupplied: { type: Boolean, default: false },

    studentName: { type: String, required: true, trim: true, maxlength: 200 },
    course: { type: String, required: true, trim: true, maxlength: 250 },
    institution: { type: String, required: true, trim: true, maxlength: 250 },
    issueDate: { type: Date, required: true },
    graduationDate: { type: Date, default: null },
    department: { type: String, trim: true, maxlength: 200, default: '' },
    academicYear: { type: String, trim: true, maxlength: 40, default: '' },
    notes: { type: String, trim: true, maxlength: 2000, default: '' },

    // PDF is stored in object storage; only metadata lives here.
    pdfStorageKey: { type: String, required: true },
    // The immutable upload is kept separately from the printable PDF with its embedded QR.
    pdfFinalStorageKey: { type: String, default: null },
    pdfOriginalFilename: { type: String, required: true, maxlength: 255 },
    pdfContentType: { type: String, required: true, default: 'application/pdf' },
    pdfSize: { type: Number, required: true },
    pdfChecksum: { type: String, required: true }, // SHA-256 hex
    pdfFinalSize: { type: Number, default: null },
    pdfFinalChecksum: { type: String, default: null },
    pdfQrPage: { type: Number, default: null },
    pdfQrCorner: { type: String, default: null },

    status: { type: String, enum: ['valid', 'revoked'], default: 'valid', index: true },
    revokedAt: { type: Date, default: null },
    revocationReason: { type: String, trim: true, maxlength: 1000, default: '' },

    archivedAt: { type: Date, default: null, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Admin', required: true },
  },
  { timestamps: true }
);

certificateSchema.index({ studentName: 1 });
certificateSchema.index({ issueDate: -1 });
certificateSchema.index({ createdAt: -1 });

export default mongoose.model('Certificate', certificateSchema);
