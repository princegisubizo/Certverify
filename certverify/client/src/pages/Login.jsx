import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Alert, Field } from '../components/ui.jsx';
import { Brand } from '../components/Brand.jsx';

export default function Login() {
  const { admin, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (admin) return <Navigate to="/admin" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      const to = loc.state?.from && loc.state.from.startsWith('/admin') ? loc.state.from : '/admin';
      nav(to, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <section className="login-showcase" aria-label="Certificate verification portal">
        <Brand publicBrand />
        <div className="login-showcase-copy">
          <span className="showcase-kicker"><span className="live-dot" /> TRUSTED RECORDS</span>
          <h1>Every credential.<br /><span>Verified with confidence.</span></h1>
          <p>Manage official certificates and give recipients a secure way to verify their credentials.</p>
        </div>
        <div className="showcase-art" aria-hidden="true">
          <div className="art-ring art-ring-one" />
          <div className="art-ring art-ring-two" />
          <div className="certificate-art">
            <div className="certificate-art-mark"><span className="brand-mark"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 19 6v5c0 4.7-2.9 8.3-7 10-4.1-1.7-7-5.3-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg></span></div>
            <span className="art-line art-line-long" /><span className="art-line" /><span className="art-line art-line-short" />
            <div className="art-stamp">✓</div>
          </div>
        </div>
        <div className="showcase-footer"><span>Secure administration</span><span>Live certificate records</span></div>
      </section>
      <section className="login-panel">
        <div className="login-form-wrap">
          <span className="login-overline">ADMINISTRATOR ACCESS</span>
          <h2>Welcome back</h2>
          <p className="muted">Sign in to manage the certificate register.</p>
          {error && <Alert title="Couldn’t sign in">{error}</Alert>}
          <form className="login-form" onSubmit={submit} noValidate>
            <Field label="Work email" required>
              {(id) => <input id={id} type="email" placeholder="name@company.com" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />}
            </Field>
            <Field label="Password" required>
              {(id) => (
                <div className="password-wrap">
                  <input id={id} type={showPassword ? 'text' : 'password'} placeholder="Enter your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                  <button type="button" className="password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword((shown) => !shown)}>{showPassword ? 'Hide' : 'Show'}</button>
                </div>
              )}
            </Field>
            <button className="btn btn-primary btn-block login-submit" type="submit" disabled={busy || !email || !password}>{busy ? 'Signing in…' : 'Sign in to workspace'}<span aria-hidden="true">→</span></button>
          </form>
          <div className="login-secure"><span className="secure-dot">✓</span><span>Protected access for authorised staff only</span></div>
        </div>
        <footer className="login-panel-footer">© {new Date().getFullYear()} KIMU TRANSPORT</footer>
      </section>
    </div>
  );
}
