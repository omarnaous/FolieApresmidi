/** Signing in, signing up, and the two links that arrive by email: reset and verify. */
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ForgotPasswordInput, LoginInput, RegisterInput, ResetPasswordInput } from '../../shared/api';
import { ApiError } from '../lib/api';
import { messageFor, zodFields } from '../lib/errors';
import {
  useForgotPassword, useLogin, useRegister, useResendVerification, useResetPassword, useSession, useVerifyEmail,
} from '../lib/queries';
import { sheetState } from '../lib/routes';
import { CheckField, FormAlert, TextField } from '../ui/fields';
import { SheetLink } from '../ui/SheetLink';
import { useFormErrors } from '../ui/useFormErrors';

const idFor = (field: string) => `acct-${field}`;

function Screen({ eyebrow = 'Account', title, children }: { eyebrow?: string; title: string; children: ReactNode }) {
  return (
    <div className="acct acct-auth">
      <div className="co-head">
        <div className="label muted">{eyebrow}</div>
        <h1 className="display d-sm">{title}</h1>
      </div>
      {children}
    </div>
  );
}

const LOGIN_ORDER = ['email', 'password'];

export function Login({ next }: { next: string | null }) {
  const login = useLogin();
  const [values, setValues] = useState({ email: '', password: '' });
  const form = useFormErrors(LOGIN_ORDER, idFor);
  const suffix = next ? `?next=${encodeURIComponent(next)}` : '';

  const set = (field: 'email' | 'password', value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    form.clear(field);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (login.isPending) return;
    const parsed = LoginInput.safeParse(values);
    if (!parsed.success) { form.show(zodFields(parsed.error)); return; }
    form.clear();
    login.mutate(parsed.data, { onError: (err) => form.fail(err, 'That email and password do not match.') });
  };

  return (
    <Screen title="Welcome back.">
      <form onSubmit={submit} noValidate>
        <div className="co-fields">
          <TextField
            id={idFor('email')} label="Email" plain type="email" autoComplete="email"
            value={values.email} error={form.errors.email} onChange={(e) => set('email', e.target.value)}
          />
          <TextField
            id={idFor('password')} label="Password" plain type="password" autoComplete="current-password"
            value={values.password} error={form.errors.password} onChange={(e) => set('password', e.target.value)}
          />
        </div>
        <FormAlert message={form.alert} />
        <div className="co-actions">
          <button type="submit" className="btn solid block" disabled={login.isPending}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
      <div className="acct-links">
        <SheetLink className="label link-u" to="/account/forgot">Forgot password?</SheetLink>
        <SheetLink className="label link-u" to={`/account/register${suffix}`}>Create an account</SheetLink>
      </div>
    </Screen>
  );
}

const REGISTER_ORDER = ['name', 'email', 'password'];

export function Register({ next, email }: { next: string | null; email: string | null }) {
  const register = useRegister();
  const [values, setValues] = useState({ name: '', email: email ?? '', password: '', acceptsMarketing: false });
  const form = useFormErrors(REGISTER_ORDER, idFor);
  const suffix = next ? `?next=${encodeURIComponent(next)}` : '';

  const set = (field: 'name' | 'email' | 'password', value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    form.clear(field);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (register.isPending) return;
    const parsed = RegisterInput.safeParse(values);
    if (!parsed.success) { form.show(zodFields(parsed.error)); return; }
    form.clear();
    register.mutate(parsed.data, { onError: (err) => form.fail(err) });
  };

  return (
    <Screen title="Create an account.">
      <form onSubmit={submit} noValidate>
        <div className="co-fields">
          <TextField
            id={idFor('name')} label="Full name" plain autoComplete="name"
            value={values.name} error={form.errors.name} onChange={(e) => set('name', e.target.value)}
          />
          <TextField
            id={idFor('email')} label="Email" plain type="email" autoComplete="email"
            value={values.email} error={form.errors.email} onChange={(e) => set('email', e.target.value)}
          />
          <TextField
            id={idFor('password')} label="Password" plain type="password" autoComplete="new-password"
            hint="At least 10 characters"
            value={values.password} error={form.errors.password} onChange={(e) => set('password', e.target.value)}
          />
          <CheckField
            id={idFor('marketing')} label="Tell me about drops and pop-ups"
            checked={values.acceptsMarketing}
            onChange={(acceptsMarketing) => setValues((v) => ({ ...v, acceptsMarketing }))}
          />
        </div>
        <FormAlert message={form.alert} />
        <div className="co-actions">
          <button type="submit" className="btn solid block" disabled={register.isPending}>
            {register.isPending ? 'Creating…' : 'Create account'}
          </button>
        </div>
      </form>
      <div className="acct-links">
        <SheetLink className="label link-u" to={`/account/login${suffix}`}>I have an account</SheetLink>
      </div>
    </Screen>
  );
}

export function Forgot() {
  const forgot = useForgotPassword();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const form = useFormErrors(['email'], idFor);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (forgot.isPending) return;
    const parsed = ForgotPasswordInput.safeParse({ email });
    if (!parsed.success) { form.show(zodFields(parsed.error)); return; }
    form.clear();
    forgot.mutate(parsed.data, {
      onSuccess: () => setSent(true),
      // the same answer whether or not the address has an account — unless the problem is ours to fix
      onError: (err) => {
        const fixable = err instanceof ApiError && ['RATE_LIMITED', 'NETWORK', 'VALIDATION_FAILED'].includes(err.code);
        if (fixable) form.fail(err);
        else setSent(true);
      },
    });
  };

  return (
    <Screen title="Forgotten password.">
      <div aria-live="polite">
        {sent && (
          <p className="lede">If an account exists for that email, we sent a link to set a new password.</p>
        )}
      </div>
      {!sent && (
        <form onSubmit={submit} noValidate>
          <div className="co-fields">
            <TextField
              id={idFor('email')} label="Email" plain type="email" autoComplete="email"
              value={email} error={form.errors.email}
              onChange={(e) => { setEmail(e.target.value); form.clear('email'); }}
            />
          </div>
          <FormAlert message={form.alert} />
          <div className="co-actions">
            <button type="submit" className="btn solid block" disabled={forgot.isPending}>
              {forgot.isPending ? 'Sending…' : 'Send the link'}
            </button>
          </div>
        </form>
      )}
      <div className="acct-links">
        <SheetLink className="label link-u" to="/account/login">Back to sign in</SheetLink>
      </div>
    </Screen>
  );
}

export function Reset({ token }: { token: string | null }) {
  const reset = useResetPassword();
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState('');
  const form = useFormErrors(['password'], idFor);

  if (!token || token.length < 20) {
    return (
      <Screen title="This link is incomplete.">
        <p className="lede">Copy the whole link from the email, or ask for a new one.</p>
        <div className="acct-links">
          <SheetLink className="label link-u" to="/account/forgot" replace>Ask for a new link</SheetLink>
        </div>
      </Screen>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (reset.isPending) return;
    const parsed = ResetPasswordInput.safeParse({ token, password });
    if (!parsed.success) { form.show(zodFields(parsed.error, (p) => (p === 'token' ? null : p))); return; }
    form.clear();
    reset.mutate(parsed.data, {
      onSuccess: () => navigate('/account', {
        replace: true,
        state: { ...sheetState(location.state), notice: 'Your new password is set.' },
      }),
      onError: (err) => form.fail(err, 'This link has expired or was already used. Ask for a new one.'),
    });
  };

  return (
    <Screen title="Set a new password.">
      <form onSubmit={submit} noValidate>
        <div className="co-fields">
          <TextField
            id={idFor('password')} label="New password" plain type="password" autoComplete="new-password"
            hint="At least 10 characters"
            value={password} error={form.errors.password}
            onChange={(e) => { setPassword(e.target.value); form.clear('password'); }}
          />
        </div>
        <FormAlert message={form.alert} />
        <div className="co-actions">
          <button type="submit" className="btn solid block" disabled={reset.isPending}>
            {reset.isPending ? 'Saving…' : 'Set password'}
          </button>
        </div>
      </form>
      {form.alert && (
        <div className="acct-links">
          <SheetLink className="label link-u" to="/account/forgot" replace>Ask for a new link</SheetLink>
        </div>
      )}
    </Screen>
  );
}

export function Verify({ token }: { token: string | null }) {
  const verify = useVerifyEmail();
  const resend = useResendVerification();
  const customer = useSession().data?.customer ?? null;
  const tried = useRef(false);
  const valid = !!token && token.length >= 20;
  const { mutate } = verify;

  // the link is the form: submit it once, as soon as it opens
  useEffect(() => {
    if (!valid || !token || tried.current) return;
    tried.current = true;
    mutate({ token });
  }, [valid, token, mutate]);

  if (!valid) {
    return (
      <Screen title="This link is incomplete.">
        <p className="lede">Copy the whole link from the email and try again.</p>
      </Screen>
    );
  }

  if (verify.isSuccess) {
    return (
      <Screen title="Your email is verified.">
        <p className="lede" role="status">Thank you. That is all it needed.</p>
        <div className="co-actions">
          <SheetLink className="btn solid" to="/account" replace>Go to your account</SheetLink>
        </div>
      </Screen>
    );
  }

  if (verify.isError) {
    return (
      <Screen title="This link did not work.">
        <p className="lede" role="alert">{messageFor(verify.error, 'It may have expired or already been used.')}</p>
        {customer && !customer.emailVerified && (
          <div className="acct-links" aria-live="polite">
            <button
              className="label link-u"
              onClick={() => resend.mutate()}
              disabled={resend.isPending || resend.isSuccess}
            >
              {resend.isSuccess ? 'Sent — check your inbox' : resend.isPending ? 'Sending…' : 'Send a new link'}
            </button>
            {resend.isError && <span className="co-err label">{messageFor(resend.error)}</span>}
          </div>
        )}
      </Screen>
    );
  }

  return (
    <Screen title="Checking your link…">
      <p className="label muted" role="status">One moment.</p>
    </Screen>
  );
}
