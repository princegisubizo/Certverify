import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, apiUrl, fmtDate, INSTITUTION } from '../api.js';
import { CopyButton, Spinner } from '../components/ui.jsx';

/**
 * Result state machine. The ONLY way to reach "valid" is an HTTP 200 whose body says status === 'valid'.
 * Any network error, 5xx, malformed body or unknown status ends in "unavailable" – never a false success.
 */
export function classify(result) {
  if (result.error) {
    if (result.error.status === 404 && result.error.code === 'CERTIFICATE_NOT_FOUND') return { kind: 'notfound' };
    return { kind: 'unavailable', message: result.error.message };
  }
  const d = result.data;
  if (d && d.status === 'valid') return { kind: 'valid', cert: d };
  if (d && d.status === 'revoked') return { kind: 'revoked', cert: d };
  return { kind: 'unavailable', message: 'The server returned an unexpected response.' };
}

function useDesktopPreview() {
  const q = '(min-width: 900px) and (pointer: fine)';
  const [on, setOn] = useState(() => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(q).matches);
  useEffect(() => {
    if (!window.matchMedia) return;
    const m = window.matchMedia(q);
    const h = () => setOn(m.matches);
    m.addEventListener?.('change', h);
    return () => m.removeEventListener?.('change', h);
  }, []);
  return on;
}

function Verdict({ kind, title, children }) {
  const icon = { valid: '✓', revoked: '!', notfound: '?', unavailable: '…' }[kind];
  return (
    <div className={`verdict verdict-${kind}`} role="status">
      <div className="icon" aria-hidden="true">{icon}</div>
      <div>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
    </div>
  );
}

export default function Verify() {
  const { certificateId } = useParams();
  const [state, setState] = useState({ kind: 'loading' });
  const preview = useDesktopPreview();

  const load = useCallback(() => {
    const ctrl = new AbortController();
    setState({ kind: 'loading' });
    api(`/api/verify/${encodeURIComponent(certificateId)}`, { signal: ctrl.signal })
      .then((data) => setState(classify({ data })))
      .catch((error) => error.name !== 'AbortError' && setState(classify({ error })));
    return () => ctrl.abort();
  }, [certificateId]);

  useEffect(() => load(), [load]);

  const pdfUrl = apiUrl(`/api/verify/${encodeURIComponent(certificateId)}/pdf`);
  const shareUrl = typeof window !== 'undefined' ? window.location.href : '';
  const share = async () => {
    try {
      await navigator.share({ title: 'Certificate verification', url: shareUrl });
    } catch {
      /* user cancelled */
    }
  };

  if (state.kind === 'loading') return <Spinner label="Checking the official record…" />;

  if (state.kind === 'notfound') {
    return (
      <div className="verify-wrap">
        <Verdict kind="notfound" title="Certificate Not Found">
          No matching official record was found for <span className="mono">{certificateId}</span>.
        </Verdict>
        <div className="card">
          <h2>What you can do</h2>
          <ul>
            <li>Check that the QR code is fully visible and scan it again, or type the certificate number carefully.</li>
            <li>A certificate without a matching official record cannot be treated as genuine.</li>
            <li>Contact {INSTITUTION} to confirm the certificate directly.</li>
          </ul>
          <Link className="btn btn-secondary" to="/">Try another certificate number</Link>
        </div>
      </div>
    );
  }

  if (state.kind === 'unavailable') {
    return (
      <div className="verify-wrap">
        <Verdict kind="unavailable" title="Verification Unavailable">
          We couldn’t check this certificate right now, so we can’t say whether it is valid or not.
        </Verdict>
        <div className="card">
          <p className="muted">{state.message}</p>
          <p>Please try again in a few moments. If the problem continues, contact {INSTITUTION}.</p>
          <button type="button" className="btn btn-primary" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  const { cert } = state;
  const revoked = state.kind === 'revoked';

  return (
    <div className="verify-wrap">
      {revoked ? (
        <Verdict kind="revoked" title="Certificate Revoked">
          {INSTITUTION} has revoked this certificate. It must <strong>not</strong> be treated as valid.
        </Verdict>
      ) : (
        <Verdict kind="valid" title="Certificate Verified">
          This certificate matches an official record held by {cert.institution}.
        </Verdict>
      )}

      <section className="card" aria-labelledby="details-h">
        <h2 id="details-h">Official certificate details</h2>
        <dl className="dl">
          <dt>Student name</dt><dd>{cert.studentName}</dd>
          <dt>Certificate number</dt><dd className="mono">{cert.certificateId}</dd>
          <dt>Course / qualification</dt><dd>{cert.course}</dd>
          <dt>Issuing institution</dt><dd>{cert.institution}</dd>
          <dt>Issue date</dt><dd>{fmtDate(cert.issueDate)}</dd>
          {cert.academicYear && (<><dt>Academic year</dt><dd>{cert.academicYear}</dd></>)}
          <dt>Status</dt>
          <dd>
            <span className={`badge badge-${cert.status}`}>{revoked ? 'Revoked' : 'Valid'}</span>
            {revoked && cert.revokedAt && <span className="muted"> &nbsp;since {fmtDate(cert.revokedAt)}</span>}
          </dd>
        </dl>
        <p className="hint" style={{ marginTop: 16 }}>Status checked live against the official record on {new Date(cert.checkedAt).toLocaleString()}.</p>
      </section>

      {cert.pdfAvailable && (
        <section className="card" aria-labelledby="pdf-h">
          <h2 id="pdf-h">
            {revoked
              ? 'PDF certificate (for reference only)'
              : cert.pdfContainsQr
                ? 'Printable certificate with embedded QR code'
                : 'Original PDF certificate'}
          </h2>
          {revoked && <p className="muted">This document is shown for audit and reference only. It is no longer a valid certificate.</p>}
          <div className="btn-row">
            <a className="btn btn-primary" href={pdfUrl} target="_blank" rel="noopener noreferrer">
              {revoked ? 'View PDF (reference only)' : cert.pdfContainsQr ? 'View printable PDF certificate' : 'View Original PDF Certificate'}
            </a>
            {cert.downloadAllowed && (
              <a className="btn btn-secondary" href={`${pdfUrl}?download=1`} download>
                Download PDF Certificate
              </a>
            )}
          </div>
          {preview && (
            <iframe className="pdf-frame" title="Original PDF certificate" src={`${pdfUrl}#toolbar=1&navpanes=0`} style={{ marginTop: 16 }} />
          )}
        </section>
      )}

      <div className="btn-row" style={{ marginTop: 16 }}>
        <CopyButton text={shareUrl} label="Copy verification link" />
        {typeof navigator !== 'undefined' && navigator.share && (
          <button type="button" className="btn btn-secondary" onClick={share}>Share</button>
        )}
      </div>
    </div>
  );
}
