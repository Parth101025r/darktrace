import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { isLoggedIn, login as apiLogin, signup as apiSignup, logout as apiLogout } from '../api';
import Login from '../pages/Login';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [authed, setAuthed] = useState(isLoggedIn);

  // api.js fires this when a token is rejected (expired) or the user logs out
  useEffect(() => {
    const sync = () => setAuthed(isLoggedIn());
    window.addEventListener('dt-auth-changed', sync);
    return () => window.removeEventListener('dt-auth-changed', sync);
  }, []);

  const login = useCallback(async (username, password) => {
    await apiLogin(username, password);
    setAuthed(true);
  }, []);

  const signup = useCallback(async (fields) => {
    await apiSignup(fields);
    await apiLogin(fields.username, fields.password);
    setAuthed(true);
  }, []);

  const logout = useCallback(() => {
    apiLogout();
    setAuthed(false);
  }, []);

  return <AuthContext.Provider value={{ authed, login, signup, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

// Shows the login screen until there is a token
export function AuthGate({ children }) {
  const { authed } = useAuth();
  return authed ? children : <Login />;
}
