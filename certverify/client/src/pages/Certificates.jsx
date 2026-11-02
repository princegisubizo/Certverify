import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, apiUrl, fmtDateShort } from '../api.js';
import { Alert, CopyButton, Spinner, StatusBadge } from '../components/ui.jsx';
import StatusAction from '../components/StatusAction.jsx';

export default function Certificates() {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const status = params.get('status') || '';
  const issueFrom = params.get('issueFrom') || '';
  const issueTo = params.get('issueTo') || '';
  const page = Number(params.get('page') || 1);

  const [search, setSearch] = useState(q);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const set = (patch) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    if (!('page' in patch)) next.delete('page');
    setParams(next);
  };

  const load = useCallback(() => {
    setLoading(true);
    setError('');
    const qs = new URLSearchParams({ page: String(page), limit: '10' });
    if (q) qs.set('q', q);
    if (status) qs.set('status', status);
    if (issueFrom) qs.set('issueFrom', issueFrom);
    if (issueTo) qs.set('issueTo', issueTo);
    api(`/api/certificates?${qs}`).then(setData).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [q, status, issueFrom, issueTo, page]);
  useEffect(load, [load]);

  const replace = (updated) =>
    setData((d) => ({ ...d, items: d.items.map((c) => (c.certificateId === updated.certificateId ? updated : c)) }));

  return (
    <div>
      <div className="page-head">
        <div><h1>Certificates</h1><p className="muted">Search, filter and manage every registered certificate.</p></div>
        <Link className="btn btn-primary" to="/admin/certificates/new">Upload new certificate</Link>
      </div>

      <form className="filters" onSubmit={(e) => { e.preventDefault(); set({ q: search.trim() }); }} role="search">
        <div className="wide"><label className="sr-only" htmlFor="s">Search</label><input id="s" type="search" placeholder="Search name, number, course, institution…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <div><label className="sr-only" htmlFor="st">Status</label>
          <select id="st" value={status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">All statuses</option><option value="valid">Valid</option><option value="revoked">Revoked</option>
          </select></div>
        <div><label className="hint" htmlFor="f">Issued from</label><input id="f" type="date" value={issueFrom} onChange={(e) => set({ issueFrom: e.target.value })} /></div>
        <div><label className="hint" htmlFor="t">Issued to</label><input id="t" type="date" value={issueTo} onChange={(e) => set({ issueTo: e.target.value })} /></div>
        <button className="btn btn-secondary" type="submit">Search</button>
      </form>

      {error && <Alert title="Couldn’t load certificates" action={<button className="btn btn-secondary btn-sm" onClick={load}>Retry</button>}>{error}</Alert>}
      {loading && !data && <Spinner />}
      {data && data.items.length === 0 && (
        <div className="card center-block">
          <p className="muted">{q || status || issueFrom || issueTo ? 'No certificates match your filters.' : 'No certificates have been uploaded yet.'}</p>
          {(q || status || issueFrom || issueTo) && <button className="btn btn-secondary" onClick={() => { setSearch(''); setParams({}); }}>Clear filters</button>}
        </div>
      )}
      {data && data.items.length > 0 && (
        <>
          <div className="table-wrap" aria-busy={loading}>
            <table>
              <thead><tr><th>Student</th><th>Certificate no.</th><th>Course</th><th>Institution</th><th>Issued</th><th>Uploaded</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {data.items.map((c) => {
                  const id = encodeURIComponent(c.certificateId);
                  return (
                    <tr key={c.certificateId}>
                      <td><Link to={`/admin/certificates/${id}`}>{c.studentName}</Link></td>
                      <td className="mono">{c.certificateId}</td>
                      <td>{c.course}</td>
                      <td>{c.institution}</td>
                      <td>{fmtDateShort(c.issueDate)}</td>
                      <td>{fmtDateShort(c.createdAt)}</td>
                      <td><StatusBadge status={c.status} /></td>
                      <td className="actions">
                        <Link className="btn btn-secondary btn-sm" to={`/admin/certificates/${id}`}>View</Link>
                        <a className="btn btn-secondary btn-sm" href={apiUrl(`/api/certificates/${id}/pdf`)} target="_blank" rel="noopener noreferrer">{c.pdfContainsQr ? 'Printable PDF' : 'PDF'}</a>
                        <a className="btn btn-secondary btn-sm" href={apiUrl(`/api/certificates/${id}/qr?format=png&download=1`)}>QR</a>
                        <CopyButton text={c.verificationUrl} label="Copy URL" className="btn btn-secondary btn-sm" />
                        <Link className="btn btn-secondary btn-sm" to={`/admin/certificates/${id}?edit=1`}>Edit</Link>
                        <StatusAction cert={c} onChanged={replace} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pager">
            <span className="muted">{data.total} certificate{data.total === 1 ? '' : 's'} · page {data.page} of {data.totalPages}</span>
            <div className="btn-row">
              <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>Previous</button>
              <button className="btn btn-secondary btn-sm" disabled={page >= data.totalPages} onClick={() => set({ page: String(page + 1) })}>Next</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
