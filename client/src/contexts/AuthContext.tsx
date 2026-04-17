import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import axios from '../lib/axios';
import type { AuthUser } from '../types';

axios.defaults.withCredentials = true;

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: () => void;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await axios.get<{ user: AuthUser | null }>('/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(() => {
    // Fall back to an empty prefix in dev (no VITE_API_URL set) so the
    // URL resolves to /auth/google on the client origin — Vite's
    // server.proxy forwards that to the backend on :3001. Without the
    // fallback the template literal interpolates the string "undefined"
    // and the browser resolves `undefined/auth/google` against the
    // current path (e.g. /album/xxx/undefined/auth/google).
    const base = import.meta.env.VITE_API_URL || '';
    window.location.href = `${base}/auth/google`;
  }, []);

  const logout = useCallback(async () => {
    try {
      await axios.post('/auth/logout');
    } catch {}
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
