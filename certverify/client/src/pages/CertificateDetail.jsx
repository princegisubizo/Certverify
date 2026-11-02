import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, apiUrl, fmtDate, fmtDateTime } from '../api.js';
import { Alert, CopyButton, Field, Modal, Spinner, StatusBadge } from '../components/ui.jsx';
import StatusAction from '../components/StatusAction.jsx';

const toDateInput = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');

function EditForm({ cert, onSaved, onCancel }) {
  const [v, setV] = useState({
    studentName: cert.studentName, course: cert.course, institution: cert.institution,
    issueDate: toDateInput(cert.issueDate), graduationDate: toDateInput(cert.graduationDate),
    department: cert.department || '', academicYear: cert.academicYear || '', notes: cert.notes || '',
  });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const on = (k) => (e) => setV((p) => ({ ...p, [k]: e.target.value }));
  const f = (k, extra = {}) => (id, bad) => <input id={id} value={v[k]} onChange={on(k)} aria-invalid={bad} {...extra} />;

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setErrors({});
    try {
      const d = await api(`/api/certificates/${encodeURIComponent(cert.certificateId)}`, { method: 'PATCH', body: v });
      onSaved(d.certificate);
    } catch (err) {
      setError(err.message);
      if (err.details) setErrors(err.details);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card" onSubmit={save} noValidate>
      <h2>Edit details</h2>
      <p className="hint">The certificate number and verification URL cannot be changed, so printed QR codes keep working.</p>
      {error && <Alert>{error}</Alert>}
      <Field label="Student’s full name" required error={errors.studentName}>{f('studentName')}</Field>
      <Field label="Course / qualification" required error={errors.course}>{f('course')}</Field>
      <Field label="Issuing institution" required error={errors.institution}>{f('institution')}</Field>
      <div className="grid-2">
        <Field label="Issue date" required error={errors.issueDate}>{f('issueDate', { type: 'date' })}</Field>
        <Field label="Graduation date" error={errors.graduationDate}>{f('graduationDate', { type: 'date' })}</Field>
        <Field label="Department">{f('department')}</Field>
        <Field label="Academic year">{f('academicYear')}</Field>
      </div>
      <Field label="Internal notes">{(id) => <textarea id={id} value={v.notes} onChange={on('notes')} />}</Field>
      <div className="btn-row">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </form>
  );
}

function ReplacePdf({ cert, onDone, onClose }) {
  const [file, setFile] = useState(null);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setError('');
    const form = new FormData();
    form.append('pdf', file);
    form.append('confirm', 'true');
    try {
      const d = await api(`/api/certificates/${encodeURIComponent(cert.certificateId)}/pdf`, { method: 'POST', form });
      onDone(d.certificate);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Replace the PDF"
      onClose={onClose}
      actions={
        <>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-danger" disabled={!file || !ok || busy} onClick={go}>{busy ? 'Replacing…' : 'Replace PDF'}</button>
        </>
      }
    >
      <p>The verification URL and QR code for <strong>{cert.certificateId}</strong> stay the same. The current PDF will be permanently replaced and the change recorded in the audit log.</p>
      {error && <Alert>{error}</Alert>}
      <Field label="New PDF" required>
        {(id) => <input id={id} type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />}
      </Field>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <input type="checkbox" style={{ width: 20, minHeight: 20, marginTop: 3 }} checked={ok} onChange={(e) => setOk(e.target.checked)} />
        <span>I confirm this PDF belongs to <strong>{cert.studentName}</strong> ({cert.course}).</span>
      </label>
    </Modal>
  );
}

export default function CertificateDetail() {
  const { certificateId } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const [cert, setCert] = useState(null);
  const [audit, setAudit] = useState([]);
  const [error, setError] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [notice, setNotice] = useState('');
  const editing = params.get('edit') === '1';

  const load = useCallback(() => {
    const id = encodeURIComponent(certificateId);
    api(`/api/certificates/${id}`).then((d) => setCert(d.certificate)).catch((e) => setError(e.message));
    api(`/api/certificates/${id}/audit`).then((d) => setAudit(d.items)).catch(() => setAudit([]));
  }, [certificateId]);
  useEffect(load, [load]);

  const changed = (c, msg) => {
    setCert(c);
    if (msg) setNotice(msg);
    api(`/api/certificates/${encodeURIComponent(certificateId)}/audit`).then((d) => setAudit(d.items)).catch(() => {});
  };

  const archive = async () => {
    try {
      await api(`/api/certificates/${encodeURIComponent(certificateId)}?confirm=true`, { method: 'DELETE' });
      nav('/admin/certificates');
    } catch (e) {
      setError(e.message);
      setArchiving(false);
    }
  };

  const regeneratePdf = async () => {
    setRegenerating(true);
    setError('');
    try {
      const d = await api(`/api/certificates/${encodeURIComponent(certificateId)}/pdf/regenerate`, { method: 'POST' });
      changed(d.certificate, 'Printable PDF regenerated. The certificate ID and verification URL are unchanged.');
    } catch (e) {
      setError(e.message);
    } finally {
      setRegenerating(false);
    }
  };

  if (error && !cert) return <Alert title="Couldn’t load this certificate" action={<Link className="btn btn-secondary btn-sm" to="/admin/certificates">Back to list</Link>}>{error}</Alert>;
  if (!cert) return <Spinner />;
  const id = encodeURIComponent(cert.certificateId);

  return (
    <div>
      <p><Link to="/admin/certificates">← All certificates</Link></p>
      <div className="page-head">
        <div>
          <h1>{cert.studentName} <StatusBadge status={cert.status} /></h1>
          <p className="muted mono">{cert.certificateId}</p>
        </div>
        <div className="btn-row">
          <button className="btn btn-secondary" onClick={() => setParams(editing ? {} : { edit: '1' })}>{editing ? 'Close editor' : 'Edit details'}</button>
          <button className="btn btn-secondary" onClick={regeneratePdf} disabled={regenerating}>{regenerating ? 'Regenerating…' : 'Regenerate printable PDF'}</button>
          <button className="btn btn-secondary" onClick={() => setReplacing(true)}>Replace PDF</button>
          <StatusAction cert={cert} onChanged={(c) => changed(c, c.status === 'revoked' ? 'Certificate revoked.' : 'Certificate restored.')} small={false} />
        </div>
      </div>
      {notice && <Alert kind="success">{notice}</Alert>}
      {error && <Alert>{error}</Alert>}

      {editing && <EditForm cert={cert} onCancel={() => setParams({})} onSaved={(c) => { changed(c, 'Details saved.'); setParams({}); }} />}

      <div className="card">
        <h2>Record</h2>
        <dl className="dl">
          <dt>Course</dt><dd>{cert.course}</dd>
          <dt>Institution</dt><dd>{cert.institution}</dd>
          <dt>Issue date</dt><dd>{fmtDate(cert.issueDate)}</dd>
          {cert.graduationDate && (<><dt>Graduation</dt><dd>{fmtDate(cert.graduationDate)}</dd></>)}
          {cert.department && (<><dt>Department</dt><dd>{cert.department}</dd></>)}
          {cert.academicYear && (<><dt>Academic year</dt><dd>{cert.academicYear}</dd></>)}
          {cert.notes && (<><dt>Internal notes</dt><dd>{cert.notes}</dd></>)}
          <dt>Uploaded</dt><dd>{fmtDateTime(cert.createdAt)}</dd>
          <dt>Original PDF</dt><dd>{cert.pdfOriginalFilename} <span className="muted">({Math.round(cert.pdfSize / 1024)} KB)</span></dd>
          <dt>Original SHA-256</dt><dd className="mono" style={{ fontSize: '.78rem' }}>{cert.pdfChecksum}</dd>
          {cert.pdfFinalChecksum && (
            <>
              <dt>Printable PDF SHA-256</dt><dd className="mono" style={{ fontSize: '.78rem' }}>{cert.pdfFinalChecksum}</dd>
              <dt>QR code embedded</dt><dd>Yes, page {cert.pdfQrPage || 1}, {cert.pdfQrCorner || 'bottom-right'}</dd>
            </>
          )}
          {cert.status === 'revoked' && (<><dt>Revoked</dt><dd>{fmtDateTime(cert.revokedAt)} — {cert.revocationReason}</dd></>)}
        </dl>
      </div>

      <div className="card">
        <h2>QR code &amp; verification URL</h2>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <img className="qr-img" alt={`QR code for ${cert.certificateId}`} src={apiUrl(`/api/certificates/${id}/qr?format=png`)} />
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="urlbox"><span className="mono">{cert.verificationUrl}</span><CopyButton text={cert.verificationUrl} /></div>
            <div className="btn-row" style={{ marginTop: 14 }}>
              <a className="btn btn-primary" href={apiUrl(`/api/certificates/${id}/qr?format=png&download=1`)}>Download PNG</a>
              <a className="btn btn-secondary" href={apiUrl(`/api/certificates/${id}/qr?format=svg&download=1`)}>Download SVG</a>
              <a className="btn btn-secondary" href={cert.verificationUrl} target="_blank" rel="noopener noreferrer">Open public page</a>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>{cert.pdfContainsQr ? 'Printable PDF' : 'PDF without embedded QR'}</h2>
        {!cert.pdfContainsQr && (
          <p className="muted">This existing record has no QR-embedded copy yet. Replace the PDF to create a printable version with its verification QR code.</p>
        )}
        <div className="btn-row" style={{ marginBottom: 14 }}>
          <a className="btn btn-primary" href={apiUrl(`/api/certificates/${id}/pdf?download=1`)}>{cert.pdfContainsQr ? 'Download printable PDF' : 'Download PDF'}</a>
          <a className="btn btn-secondary" href={apiUrl(`/api/certificates/${id}/pdf`)} target="_blank" rel="noopener noreferrer">{cert.pdfContainsQr ? 'Preview printable PDF' : 'Preview PDF'}</a>
        </div>
        <iframe key={cert.pdfFinalChecksum || cert.pdfChecksum} className="pdf-frame" title={cert.pdfContainsQr ? 'Printable certificate PDF with embedded QR code' : 'Certificate PDF'} src={apiUrl(`/api/certificates/${id}/pdf`)} />
      </div>

      <div className="card">
        <h2>Preserved original upload</h2>
        <p className="muted">This administrator-only file is the original PDF exactly as uploaded, without the QR code.</p>
        <div className="btn-row">
          <a className="btn btn-secondary" href={apiUrl(`/api/certificates/${id}/original-pdf?download=1`)}>Download original PDF</a>
          <a className="btn btn-secondary" href={apiUrl(`/api/certificates/${id}/original-pdf`)} target="_blank" rel="noopener noreferrer">Open original PDF</a>
        </div>
      </div>

      <div className="card">
        <h2>Audit log</h2>
        {audit.length === 0 ? <p className="muted">No entries.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>Action</th><th>By</th></tr></thead>
            <tbody>{audit.map((a, i) => <tr key={i}><td>{fmtDateTime(a.createdAt)}</td><td>{a.action}</td><td>{a.actorEmail || '—'}</td></tr>)}</tbody>
          </table></div>
        )}
      </div>

      <div className="card">
        <h2>Archive</h2>
        <p className="muted">Archiving removes this record from the register and makes its QR code show “Certificate Not Found”. The PDF is retained in storage. Revoke instead if you want the public page to say the certificate is no longer valid.</p>
        <button className="btn btn-danger" onClick={() => setArchiving(true)}>Archive certificate…</button>
      </div>

      {replacing && <ReplacePdf cert={cert} onClose={() => setReplacing(false)} onDone={(c) => { changed(c, 'PDF replaced. The verification URL is unchanged.'); setReplacing(false); }} />}
      {archiving && (
        <Modal title="Archive this certificate?" onClose={() => setArchiving(false)} actions={<><button className="btn btn-secondary" onClick={() => setArchiving(false)}>Cancel</button><button className="btn btn-danger" onClick={archive}>Archive</button></>}>
          <p>Scanning the QR code for <strong>{cert.certificateId}</strong> will show “Certificate Not Found”.</p>
        </Modal>
      )}
    </div>
  );
}
