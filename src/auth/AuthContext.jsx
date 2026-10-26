import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiHeartbeat, apiLogin, apiLogout, apiMe, apiRegister } from '../api/authApi';
import { TIMINGS } from '../config/timings';

const TOKEN_KEY = 'wakanda_auth_token';
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const persist = useCallback((nextToken, nextUser) => {
    if (nextToken) localStorage.setItem(TOKEN_KEY, nextToken);
    else localStorage.removeItem(TOKEN_KEY);
    setToken(nextToken || '');
    setUser(nextUser || null);
  }, []);

  // Первичная проверка сохранённой сессии.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        if (cancelled) return;
        setUser(null);
        setReady(true);
        return;
      }
      setReady(false);
      try {
        const data = await apiMe(token);
        if (!cancelled) setUser(data.user);
      } catch (error) {
        // Сетевой сбой — не повод разлогинивать: токен останется, и при
        // следующем запуске/онлайне сессия проверится снова. Выходим только
        // если сервер явно отверг токен.
        if (!cancelled && (error.status === 401 || error.status === 403)) persist('', null);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, persist]);

  const status = user?.status;

  // Пока заявка на рассмотрении — каждые 5 секунд проверяем, не одобрил ли админ.
  useEffect(() => {
    if (!token || status !== 'pending') return undefined;
    const timer = window.setInterval(async () => {
      try {
        const data = await apiMe(token);
        setUser(data.user);
      } catch (error) {
        if (error.status === 401 || error.status === 403) persist('', null);
      }
    }, TIMINGS.authPendingPollMs);
    return () => window.clearInterval(timer);
  }, [token, status, persist]);

  // Пока пользователь работает — раз в 45 секунд отмечаемся как «в сети».
  useEffect(() => {
    if (!token || status !== 'approved') return undefined;
    let active = true;
    const ping = async () => {
      try {
        await apiHeartbeat(token);
      } catch (error) {
        // Сессию закрыли (кик или блокировка) — выходим на экран входа.
        if (active && (error.status === 401 || error.status === 403)) persist('', null);
      }
    };
    ping();
    const timer = window.setInterval(ping, TIMINGS.authHeartbeatMs);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [token, status, persist]);

  const login = useCallback(
    async (username, password) => {
      const data = await apiLogin(username, password);
      persist(data.token, data.user);
      return data.user;
    },
    [persist],
  );

  const register = useCallback(
    async (username, password) => {
      const data = await apiRegister(username, password);
      persist(data.token, data.user);
      return data.user;
    },
    [persist],
  );

  const logout = useCallback(async () => {
    try {
      if (token) await apiLogout(token);
    } catch {
      // даже если сервер недоступен — выходим локально
    }
    persist('', null);
  }, [token, persist]);

  const value = useMemo(
    () => ({ token, user, ready, login, register, logout, refresh: setUser }),
    [token, user, ready, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth нужно использовать внутри AuthProvider');
  return context;
}
