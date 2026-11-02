import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { INSTITUTION } from '../api.js';

export default function Home() {
  const nav = useNavigate();
  const [id, setId] = useState('');
  const submit = (e) => {
    e.preventDefault();
    let clean = id.trim();
    try {
      const pastedUrl = new URL(clean);
      const match = pastedUrl.pathname.match(/\/verify\/([^/]+)\/?$/);
      if (match) clean = decodeURIComponent(match[1]);
    } catch {
      clean = clean.toUpperCase().replace(/\s+/g, '-');
    }
    if (clean) nav(`/verify/${encodeURIComponent(clean)}`);
  };
  return (
    <div>
      <section className="hero">
        <h1>Verify a certificate issued by {INSTITUTION}</h1>
        <p className="muted" style={{ maxWidth: 620, fontSize: '1.05rem' }}>
          Scan the QR code on a printed certificate with your phone camera. You’ll see the official record, its current
          status, and the printable certificate PDF held by the institution.
        </p>
      </section>
      <ol className="steps">
        <li><span className="num">1</span><h3>Scan</h3><p className="muted">Point your phone camera at the QR code on the paper certificate.</p></li>
        <li><span className="num">2</span><h3>Check</h3><p className="muted">Confirm the name, course and status shown match the certificate in your hands.</p></li>
        <li><span className="num">3</span><h3>View the PDF</h3><p className="muted">Open the institution’s printable certificate and compare its details.</p></li>
      </ol>
      <form className="card" onSubmit={submit} style={{ maxWidth: 560 }}>
        <h2>Open a verification link</h2>
        <p className="muted">Scan the document’s QR code or paste its official verification URL below. Older certificates can be checked by certificate number.</p>
        <label htmlFor="cid" className="sr-only">Verification URL or legacy certificate number</label>
        <input id="cid" value={id} onChange={(e) => setId(e.target.value)} placeholder="Paste verification link or certificate number" autoComplete="off" />
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-primary" type="submit" disabled={!id.trim()}>Verify certificate</button>
        </div>
      </form>
      <p className="hint" style={{ marginTop: 16 }}>A QR code alone does not prove a certificate is genuine. Only a matching, currently valid official record does.</p>
    </div>
  );
}
