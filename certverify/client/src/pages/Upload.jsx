import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, apiUrl, fmtDate } from '../api.js';
import { Alert, CopyButton, Field } from '../components/ui.jsx';

const MAX_MB = 10; // UI hint only; the server enforces the real, configurable limit.
const empty = {
  studentName: '', certificateNumber: '', course: '', institution: '', issueDate: '',
  graduationDate: '', department: '', academicYear: '', notes: '',
};

function validate(v, file) {
  const e = {};
  if (!v.studentName.trim()) e.studentName = 'Enter the student’s full name.';
  if (!v.course.trim()) e.course = 'Enter the course or qualification.';
  if (!v.institution.trim()) e.institution = 'Enter the issuing institution.';
  if (!v.issueDate) e.issueDate = 'Choose the issue date.';
  if (v.certificateNumber.trim() && !/^[A-Za-z0-9][A-Za-z0-9._\- ]{2,63}$/.test(v.certificateNumber.trim()))
    e.certificateNumber = 'Use 3–64 letters, numbers, dots, hyphens or underscores (no slashes).';
  if (!file) e.pdf = 'Choose the certificate PDF to upload.';
  else if (!/\.pdf$/i.test(file.name)) e.pdf = 'Only PDF files (.pdf) are accepted.';
  else if (file.size > MAX_MB * 1024 * 1024 * 3) e.pdf = 'This file is very large. Check the size limit with your administrator.';
  return e;
}

export default function Upload() {
  const [v, setV] = useState({ ...empty, institution: '' });
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [step, setStep] = useState('form'); // form | review | done
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [created, setCreated] = useState(null);
  const fileRef = useRef(null);

  const on = (k) => (e) => setV((p) => ({ ...p, [k]: e.target.value }));
  const input = (k, extra = {}) => (id, invalid) => (
    <input id={id} value={v[k]} onChange={on(k)} aria-invalid={invalid} {...extra} />
  );

  const toReview = (e) => {
    e.preventDefault();
    const errs = validate(v, file);
    setErrors(errs);
    setServerError(null);
    if (Object.keys(errs).length) {
      document.getElementById('form-errors')?.focus();
      return;
    }
    setStep('review');
  };

  const submit = async (confirmDuplicate = false) => {
    setBusy(true);
    setServerError(null);
    const form = new FormData();
    for (const [k, val] of Object.entries(v)) if (val !== '') form.append(k, val);
    if (confirmDuplicate) form.append('confirmDuplicate', 'true');
    form.append('pdf', file);
    try {
      const d = await api('/api/certificates', { method: 'POST', form });
      setCreated(d.certificate);
      setStep('done');
    } catch (err) {
      if (err.details && typeof err.details === 'object' && err.code !== 'DUPLICATE_RECORD') {
        const mapped = { ...err.details };
        setErrors(mapped);
        setStep('form');
      }
      setServerError(err);
      if (err.code !== 'DUPLICATE_RECORD') setStep('form');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setV({ ...empty });
    setFile(null);
    setErrors({});
    setCreated(null);
    setServerError(null);
    setStep('form');
    if (fileRef.current) fileRef.current.value = '';
  };

  if (step === 'done' && created) {
    const id = encodeURIComponent(created.certificateId);
    return (
      <div className="narrow">
        <Alert kind="success" title="Certificate registered">The original PDF is preserved, and a printable copy with its QR code embedded is ready.</Alert>
        <div className="card">
          <h1 style={{ fontSize: '1.4rem' }}>{created.studentName}</h1>
          <p className="muted">{created.course} · {created.institution}</p>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <img className="qr-img" alt={`QR code for certificate ${created.certificateId}`} src={apiUrl(`/api/certificates/${id}/qr?format=png`)} />
            <div style={{ flex: 1, minWidth: 240 }}>
              <dl className="dl" style={{ gridTemplateColumns: '120px 1fr' }}>
                <dt>Certificate ID</dt><dd className="mono">{created.certificateId}</dd>
                <dt>Original SHA-256</dt><dd className="mono" style={{ fontSize: '.75rem' }}>{created.pdfChecksum}</dd>
              </dl>
              <p className="hint" style={{ marginTop: 14 }}>Permanent verification URL (encoded in the QR code):</p>
              <div className="urlbox"><span className="mono">{created.verificationUrl}</span><CopyButton text={created.verificationUrl} /></div>
            </div>
          </div>
          <div className="btn-row" style={{ marginTop: 20 }}>
            <a className="btn btn-primary" href={apiUrl(`/api/certificates/${id}/pdf?download=1`)}>Download printable PDF</a>
            <a className="btn btn-secondary" href={apiUrl(`/api/certificates/${id}/pdf`)} target="_blank" rel="noopener noreferrer">Preview printable PDF</a>
            <a className="btn btn-secondary" href={apiUrl(`/api/certificates/${id}/qr?format=png&download=1`)}>Download QR image</a>
            <a className="btn btn-secondary" href={created.verificationUrl} target="_blank" rel="noopener noreferrer">Open public page</a>
          </div>
          <p className="hint" style={{ marginTop: 14 }}>The printable PDF includes the QR code on its first page. The QR image is also available separately if needed.</p>
        </div>
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={reset}>Upload another</button>
          <Link className="btn btn-secondary" to={`/admin/certificates/${id}`}>View record</Link>
        </div>
      </div>
    );
  }

  if (step === 'review') {
    const dup = serverError?.code === 'DUPLICATE_RECORD';
    return (
      <div className="narrow">
        <h1>Confirm before saving</h1>
        <p className="muted">Check that the details match the PDF. A wrong PDF attached to the wrong student is hard to spot later.</p>
        {serverError && !dup && <Alert title="Upload failed">{serverError.message}</Alert>}
        {dup && (
          <Alert kind="warn" title="Possible duplicate">
            {serverError.message} Continue only if this is a separate certificate.
          </Alert>
        )}
        <div className="card">
          <dl className="dl">
            <dt>Student</dt><dd>{v.studentName}</dd>
            <dt>Certificate number</dt><dd>{v.certificateNumber || <span className="muted">Will be generated automatically</span>}</dd>
            <dt>Course</dt><dd>{v.course}</dd>
            <dt>Institution</dt><dd>{v.institution}</dd>
            <dt>Issue date</dt><dd>{fmtDate(v.issueDate)}</dd>
            {v.graduationDate && (<><dt>Graduation</dt><dd>{fmtDate(v.graduationDate)}</dd></>)}
            {v.department && (<><dt>Department</dt><dd>{v.department}</dd></>)}
            {v.academicYear && (<><dt>Academic year</dt><dd>{v.academicYear}</dd></>)}
            <dt>PDF file</dt><dd>{file.name} <span className="muted">({(file.size / 1024).toFixed(0)} KB)</span></dd>
          </dl>
        </div>
        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn btn-secondary" onClick={() => { setServerError(null); setStep('form'); }} disabled={busy}>Back and edit</button>
          <button className="btn btn-primary" onClick={() => submit(dup)} disabled={busy}>{busy ? 'Uploading…' : dup ? 'Save anyway' : 'Confirm and save'}</button>
        </div>
      </div>
    );
  }

  const errList = Object.entries(errors);
  return (
    <div className="narrow">
      <h1>Upload certificate</h1>
      <p className="muted">Upload the finished PDF exactly as issued, then register its details. The system preserves your upload and creates a separate printable PDF with a unique verification QR code embedded.</p>
      {serverError && <Alert title="Couldn’t save">{serverError.message}</Alert>}
      {errList.length > 0 && (
        <div id="form-errors" tabIndex={-1} role="alert" className="alert alert-error" style={{ display: 'block' }}>
          <strong>Please fix the following:</strong>
          <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>{errList.map(([k, m]) => <li key={k}>{m}</li>)}</ul>
        </div>
      )}
      <form onSubmit={toReview} noValidate>
        <fieldset>
          <legend>Required details</legend>
          <Field label="Student’s full name" required error={errors.studentName}>{input('studentName', { autoComplete: 'off', maxLength: 200 })}</Field>
          <div className="grid-2">
            <Field label="Certificate number" error={errors.certificateNumber} hint="Leave blank to generate one automatically.">{input('certificateNumber', { autoComplete: 'off', maxLength: 64 })}</Field>
            <Field label="Issue date" required error={errors.issueDate}>{input('issueDate', { type: 'date' })}</Field>
          </div>
          <Field label="Course / program / qualification" required error={errors.course}>{input('course', { maxLength: 250 })}</Field>
          <Field label="Issuing institution" required error={errors.institution}>{input('institution', { maxLength: 250 })}</Field>
          <Field label="Certificate PDF" required error={errors.pdf} hint={`PDF only. Maximum size is set by the server (default ${MAX_MB} MB).`}>
            {(id, invalid) => (
              <input id={id} ref={fileRef} type="file" accept="application/pdf,.pdf" aria-invalid={invalid} onChange={(e) => setFile(e.target.files?.[0] || null)} />
            )}
          </Field>
        </fieldset>
        <fieldset>
          <legend>Optional details</legend>
          <div className="grid-2">
            <Field label="Graduation / completion date">{input('graduationDate', { type: 'date' })}</Field>
            <Field label="Academic year">{input('academicYear', { placeholder: '2025/2026', maxLength: 40 })}</Field>
          </div>
          <Field label="Department">{input('department', { maxLength: 200 })}</Field>
          <Field label="Internal notes" hint="Visible to administrators only.">
            {(id) => <textarea id={id} value={v.notes} onChange={on('notes')} maxLength={2000} />}
          </Field>
        </fieldset>
        <button className="btn btn-primary" type="submit">Review details</button>
      </form>
    </div>
  );
}
