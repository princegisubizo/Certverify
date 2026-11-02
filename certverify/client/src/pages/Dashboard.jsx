import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtDateShort } from '../api.js';
import { Alert, Spinner, StatusBadge } from '../components/ui.jsx';

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    api('/api/certificates/stats').then(setData).catch((e) => setError(e.message));
  };
  useEffect(load, []);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">Live figures from the certificate register.</p>
        </div>
        <Link className="btn btn-primary" to="/admin/certificates/new">Upload new certificate</Link>
      </div>
      {error && <Alert title="Couldn’t load statistics" action={<button className="btn btn-secondary btn-sm" onClick={load}>Retry</button>}>{error}</Alert>}
      {!data && !error && <Spinner />}
      {data && (
        <>
          <div className="stats">
            <div className="stat"><div className="n">{data.total}</div><div className="l">Registered certificates</div></div>
            <div className="stat"><div className="n" style={{ color: 'var(--green)' }}>{data.valid}</div><div className="l">Valid</div></div>
            <div className="stat"><div className="n" style={{ color: 'var(--red)' }}>{data.revoked}</div><div className="l">Revoked</div></div>
          </div>
          <h2>Recently uploaded</h2>
          {data.recent.length === 0 ? (
            <div className="card center-block">
              <p className="muted">No certificates yet. Upload your first PDF to generate its QR code.</p>
              <Link className="btn btn-primary" to="/admin/certificates/new">Upload a certificate</Link>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Student</th><th>Certificate no.</th><th>Course</th><th>Uploaded</th><th>Status</th></tr></thead>
                <tbody>
                  {data.recent.map((c) => (
                    <tr key={c.certificateId}>
                      <td><Link to={`/admin/certificates/${c.certificateId}`}>{c.studentName}</Link></td>
                      <td className="mono">{c.certificateId}</td>
                      <td>{c.course}</td>
                      <td>{fmtDateShort(c.createdAt)}</td>
                      <td><StatusBadge status={c.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
