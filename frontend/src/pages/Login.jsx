import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import '../styles/login.css';

export default function Login() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'signin') await login(username, password);
      else await signup({ username, email, password });
    } catch (err) {
      setError(err.message || 'Something went wrong');
      setBusy(false);
    }
  };

  const isSignup = mode === 'signup';

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <h1 className="login__title">DarkTrace</h1>
        <p className="login__sub">{isSignup ? 'Create your analyst account' : 'Sign in to continue'}</p>

        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required autoFocus />
        </label>

        {isSignup && (
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
        )}

        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignup ? 'new-password' : 'current-password'}
            minLength={isSignup ? 8 : undefined}
            required
          />
        </label>

        {error && <div className="login__error" role="alert">{error}</div>}

        <button className="login__btn" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in'}
        </button>

        <button
          type="button"
          className="login__switch"
          onClick={() => { setMode(isSignup ? 'signin' : 'signup'); setError(''); }}
        >
          {isSignup ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </button>
      </form>
    </div>
  );
}
