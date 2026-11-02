import { useState } from 'react';
import { api } from '../api.js';
import { Alert, Field, Modal } from './ui.jsx';

/** Revoke / restore with a confirmation dialog. Renders the trigger button and the dialog. */
export default function StatusAction({ cert, onChanged, small = true }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const revoking = cert.status === 'valid';

  const close = () => {
    setOpen(false);
    setReason('');
    setError('');
  };
  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      const body = revoking ? { status: 'revoked', reason } : { status: 'valid' };
      const d = await api(`/api/certificates/${encodeURIComponent(cert.certificateId)}/status`, { method: 'PATCH', body });
      onChanged(d.certificate);
      close();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className={`btn ${revoking ? 'btn-secondary' : 'btn-primary'} ${small ? 'btn-sm' : ''}`} onClick={() => setOpen(true)}>
        {revoking ? 'Revoke' : 'Restore'}
      </button>
      {open && (
        <Modal
          title={revoking ? 'Revoke this certificate?' : 'Restore this certificate?'}
          onClose={close}
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={close}>Cancel</button>
              <button type="button" className={`btn ${revoking ? 'btn-danger' : 'btn-primary'}`} onClick={confirm} disabled={busy || (revoking && reason.trim().length < 3)}>
                {busy ? 'Saving…' : revoking ? 'Revoke certificate' : 'Restore certificate'}
              </button>
            </>
          }
        >
          <p>
            {revoking
              ? <>Anyone scanning the QR code for <strong>{cert.certificateId}</strong> ({cert.studentName}) will immediately see “Certificate Revoked”.</>
              : <>The certificate <strong>{cert.certificateId}</strong> ({cert.studentName}) will be shown as valid again.</>}
          </p>
          {error && <Alert>{error}</Alert>}
          {revoking && (
            <Field label="Reason for revocation (kept in the audit log)" required>
              {(id) => <textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />}
            </Field>
          )}
        </Modal>
      )}
    </>
  );
}
