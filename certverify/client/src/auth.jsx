import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api } from './api.js';
import { Spinner } from './components/ui.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    api('/api/auth/me')
      .then((d) => alive && setAdmin(d.admin))
      .catch(() => alive && setAdmin(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const login = useCallback(async (email, password) => {
    const d = await api('/api/auth/login', { method: 'POST', body: { email, password } });
    setAdmin(d.admin);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api('/api/auth/logout', { method: 'POST' });
    } finally {
      setAdmin(null);
    }
  }, []);

  return <AuthCtx.Provider value={{ admin, loading, login, logout }}>{children}</AuthCtx.Provider>;
}

export function RequireAdmin({ children }) {
  const { admin, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Spinner label="Checking your session…" />;
  if (!admin) return <Navigate to="/admin/login" replace state={{ from: loc.pathname + loc.search }} />;
  return children;
}
