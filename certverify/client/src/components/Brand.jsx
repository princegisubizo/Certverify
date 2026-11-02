import { Link } from 'react-router-dom';
import { INSTITUTION } from '../api.js';

export function Brand({ publicBrand = false }) {
  return (
    <Link to={publicBrand ? '/' : '/admin'} className="brand">
      <span className="brand-mark" aria-hidden="true">
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3 19 6v5c0 4.7-2.9 8.3-7 10-4.1-1.7-7-5.3-7-10V6l7-3Z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      </span>
      <span className="brand-copy">
        <strong>{INSTITUTION}</strong>
        <small>{publicBrand ? 'CERTIFICATE VERIFICATION' : 'CERTIFICATE PORTAL'}</small>
      </span>
    </Link>
  );
}

export function NavIcon({ name }) {
  const paths = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /></>,
    records: <><path d="M8 4h10a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" /><path d="M6 8H4v12a2 2 0 0 0 2 2h12M10 9h6M10 13h6" /></>,
    upload: <><path d="M12 16V4m0 0L8 8m4-4 4 4" /><path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></>,
    logout: <><path d="M10 17l5-5-5-5m5 5H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  };
  return <svg className="nav-icon" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
