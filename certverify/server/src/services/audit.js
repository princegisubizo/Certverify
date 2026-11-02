import AuditLog from '../models/AuditLog.js';

export async function audit(req, action, certificateId = '', details = {}) {
  try {
    await AuditLog.create({
      action,
      actor: req.admin?._id ?? null,
      actorEmail: req.admin?.email ?? '',
      certificateId,
      details,
      ip: req.ip || '',
    });
  } catch (e) {
    // Never fail the primary operation because logging failed, but make it visible.
    console.error('[audit] failed to write audit log', e.message);
  }
}
