import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { INSTITUTION } from './api.js';
import { RequireAdmin, useAuth } from './auth.jsx';
import { Brand, NavIcon } from './components/Brand.jsx';
import Home from './pages/Home.jsx';
import Verify from './pages/Verify.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Certificates from './pages/Certificates.jsx';
import Upload from './pages/Upload.jsx';
import CertificateDetail from './pages/CertificateDetail.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

function PublicLayout() {
  return (
    <div className="public-shell">
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="container">
          <Brand publicBrand />
          <nav className="nav public-nav" aria-label="Main">
            <span className="public-trust"><span className="live-dot" /> Official verification portal</span>
            <Link to="/admin">Staff sign in</Link>
          </nav>
        </div>
      </header>
      <main id="main"><div className="container public-content"><Outlet /></div></main>
      <footer className="site-footer"><div className="container"><span>© {new Date().getFullYear()} {INSTITUTION}</span><span>Official records · Secure verification</span></div></footer>
    </div>
  );
}

function AdminLayout() {
  const { admin, logout } = useAuth();
  const nav = useNavigate();
  const location = useLocation();
  const pageTitle = location.pathname.includes('/new')
    ? 'Register certificate'
    : location.pathname.includes('/certificates/')
      ? 'Certificate record'
      : location.pathname.includes('/certificates')
        ? 'Certificate register'
        : 'Overview';
  const initials = (admin?.name || admin?.email || 'A')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

  return (
    <div className="admin-shell">
      <a className="skip" href="#main">Skip to content</a>
      <aside className="admin-sidebar">
        <Brand />
        <div className="sidebar-rule" />
        <p className="sidebar-label">WORKSPACE</p>
        <nav className="sidebar-nav" aria-label="Admin navigation">
          <NavLink to="/admin" end><NavIcon name="overview" /><span>Overview</span></NavLink>
          <NavLink to="/admin/certificates" end><NavIcon name="records" /><span>Certificates</span></NavLink>
          <NavLink to="/admin/certificates/new"><NavIcon name="upload" /><span>Register certificate</span></NavLink>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-secure"><span className="secure-icon"><NavIcon name="records" /></span><span><strong>Secure register</strong><small>Private staff workspace</small></span></div>
          <div className="profile-block">
            <span className="avatar">{initials}</span>
            <span className="profile-copy"><strong>{admin?.name || 'Administrator'}</strong><small>{admin?.email}</small></span>
          </div>
          <button type="button" className="sidebar-logout" onClick={async () => { await logout(); nav('/admin/login'); }}>
            <NavIcon name="logout" /><span>Sign out</span>
          </button>
        </div>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <div className="topbar-title"><span className="eyebrow">KIMU TRANSPORT / CERTIFICATES</span><strong>{pageTitle}</strong></div>
          <div className="topbar-meta"><span className="topbar-date"><NavIcon name="calendar" />{new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</span><span className="topbar-avatar">{initials}</span></div>
        </header>
        <main id="main" className="admin-main"><div className="admin-content"><Outlet /></div></main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="/verify/:certificateId" element={<Verify />} />
        <Route path="/admin/login" element={<Login />} />
      </Route>
      <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
        <Route index element={<Dashboard />} />
        <Route path="certificates" element={<Certificates />} />
        <Route path="certificates/new" element={<Upload />} />
        <Route path="certificates/:certificateId" element={<CertificateDetail />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
      <Route element={<PublicLayout />}>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
