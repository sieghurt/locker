import { FormEvent, useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { authApi, describeError } from '../api/client';
import type { DemoInfo } from '../api/types';
import { canUse, homeFor, useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const { user, requestCode, login } = useAuth();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [demo, setDemo] = useState<DemoInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    authApi
      .demo()
      .then((info) => !cancelled && setDemo(info))
      .catch(() => !cancelled && setDemo({ enabled: false, accounts: [] }));
    return () => {
      cancelled = true;
    };
  }, []);

  // Return them to where they were, but never to a screen their role cannot use.
  if (user)
    return <Navigate to={from && canUse(user.role, from) ? from : homeFor(user.role)} replace />;

  /** Requests a code for `address`; in demo mode the server returns it and we log in straight away. */
  async function startLogin(address: string) {
    setBusy(true);
    setError(null);
    try {
      const demoCode = await requestCode(address);
      if (demoCode) {
        setCode(demoCode);
        await login(address, demoCode);
        return;
      }
      setStage('code');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    await startLogin(email.trim());
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), code.trim());
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="login">
      <div className="panel login-card">
        <h2>Log in</h2>
        {stage === 'email' ? (
          <form onSubmit={sendCode} className="form">
            <p className="muted">Enter your email and we will send you a one-time code.</p>
            <label>
              Email
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoFocus
              />
            </label>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send code'}
            </button>
          </form>
        ) : (
          <form onSubmit={verify} className="form">
            <p className="muted" role="status">
              If <strong>{email}</strong> has an account, a 6-digit code is on its way. It expires
              in 10 minutes.
            </p>
            <label>
              Login code
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6 digits"
                pattern="\d{4,10}"
                required
                autoFocus
                className="code-input"
              />
            </label>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Checking…' : 'Log in'}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => void startLogin(email.trim())}
              disabled={busy}
            >
              Send a new code
            </button>
            <button type="button" className="link" onClick={() => setStage('email')}>
              Use a different email
            </button>
          </form>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>

      {demo?.enabled && (
        <div className="panel login-card demo" data-testid="demo-panel">
          <h3>Demo mode</h3>
          <p className="muted small">
            This server runs with <code>DEMO_MODE=true</code>: login codes are returned on screen,
            so one click logs you in. Codes are still emailed (see the Mailpit inbox). Never enable
            this in production.
          </p>
          <ul className="demo-accounts">
            {demo.accounts.map((a) => (
              <li key={a.email}>
                <button
                  type="button"
                  className="ghost"
                  disabled={busy}
                  onClick={() => {
                    setEmail(a.email);
                    void startLogin(a.email);
                  }}
                >
                  <span className="role-tag">{a.role.toLowerCase()}</span>{' '}
                  {a.displayName ?? a.email} <span className="muted">{a.email}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
