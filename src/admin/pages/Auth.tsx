import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import {
  AcceptInviteInput,
  AdminLoginInput,
  AdminLoginVerifyInput,
  AdminSetupInput,
  ForgotPasswordInput,
  post,
  ResetPasswordInput,
  type AdminSessionDTO,
  type LoginChallengeDTO,
} from '../lib/contract';
import { apiFieldErrors, validate, type FieldErrors } from '../lib/forms';
import { useDocumentTitle } from '../lib/hooks';
import { qk } from '../lib/queries';
import { Button } from '../ui/Button';
import { Banner, ErrorBanner } from '../ui/feedback';
import { TextInput } from '../ui/form';

export function AuthShell({ title, lede, children, footer }: { title: string; lede?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useDocumentTitle(title);
  return (
    <div className="adm-auth">
      <div className="adm-auth__panel">
        <div className="adm-auth__brand">
          <span className="adm-wordmark adm-wordmark--lg">FDM</span>
          <span className="adm-label">Admin</span>
        </div>
        <h1 className="adm-auth__title">{title}</h1>
        {lede && <p className="adm-auth__lede">{lede}</p>}
        {children}
        {footer && <div className="adm-auth__footer">{footer}</div>}
      </div>
    </div>
  );
}

/** Store the returned session; the gate re-renders into the app. */
function useSessionMutation<V>(path: string, after?: () => void) {
  const qc = useQueryClient();
  const [errors, setErrors] = useState<FieldErrors>({});
  const m = useMutation({
    mutationFn: (body: V) => post<AdminSessionDTO>(path, body),
    onMutate: () => setErrors({}),
    onSuccess: (session) => {
      after?.();
      qc.setQueryData(qk.session, session);
    },
    onError: (err) => setErrors(apiFieldErrors(err)),
  });
  return { m, errors, setErrors };
}

const PASSWORD_HINT = 'At least 10 characters.';

export function LoginPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  // set once the password is accepted and a code is still needed
  const [challenge, setChallenge] = useState<string | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});

  const land = (session: AdminSessionDTO) => qc.setQueryData(qk.session, session);

  const login = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      post<AdminSessionDTO | LoginChallengeDTO>('/api/admin/auth/login', body),
    onMutate: () => setErrors({}),
    onSuccess: (res) => {
      if ('twoFactorRequired' in res) setChallenge(res.challenge);
      else land(res);
    },
    onError: (err) => setErrors(apiFieldErrors(err)),
  });

  const verify = useMutation({
    mutationFn: (body: { challenge: string; code: string }) => post<AdminSessionDTO>('/api/admin/auth/login/verify', body),
    onMutate: () => setErrors({}),
    onSuccess: land,
    onError: (err) => setErrors(apiFieldErrors(err)),
  });

  const submitPassword = (e: FormEvent) => {
    e.preventDefault();
    if (login.isPending) return;
    const body = { email, password };
    const invalid = validate(AdminLoginInput, body);
    if (invalid) return setErrors(invalid);
    login.mutate(body);
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    if (verify.isPending || !challenge) return;
    const body = { challenge, code: code.trim() };
    const invalid = validate(AdminLoginVerifyInput, body);
    if (invalid) return setErrors(invalid);
    verify.mutate(body);
  };

  if (challenge) {
    return (
      <AuthShell
        title="Enter your code"
        lede="Open your authenticator app and enter the six-digit code. Lost your phone? Use one of your backup codes."
        footer={<button type="button" className="adm-link" onClick={() => { setChallenge(null); setCode(''); setErrors({}); }}>Back to sign in</button>}
      >
        <form className="adm-stack" onSubmit={submitCode} noValidate>
          <ErrorBanner error={verify.error} />
          <TextInput
            label="Authentication code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            error={errors.code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
          />
          <Button type="submit" variant="primary" loading={verify.isPending} className="adm-btn--block">
            Verify
          </Button>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Sign in" footer={<Link to="/admin/forgot">Forgot your password?</Link>}>
      <form className="adm-stack" onSubmit={submitPassword} noValidate>
        <ErrorBanner error={login.error} />
        <TextInput label="Email" type="email" autoComplete="username" value={email} error={errors.email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        <TextInput label="Password" type="password" autoComplete="current-password" value={password} error={errors.password} onChange={(e) => setPassword(e.target.value)} />
        <Button type="submit" variant="primary" loading={login.isPending} className="adm-btn--block">
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const m = useMutation({
    mutationFn: (body: { email: string }) => post<void>('/api/admin/auth/forgot-password', body),
    onError: (err) => setErrors(apiFieldErrors(err)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (m.isPending) return;
    const invalid = validate(ForgotPasswordInput, { email });
    if (invalid) return setErrors(invalid);
    setErrors({});
    m.mutate({ email });
  };
  return (
    <AuthShell
      title="Reset your password"
      lede="Enter the email you sign in with and we'll send a link to choose a new password."
      footer={<Link to="/admin/login">Back to sign in</Link>}
    >
      {m.isSuccess ? (
        <Banner tone="success" title="Check your inbox">
          <p>If an account exists for {email}, a reset link is on its way. It expires soon, so use it shortly.</p>
        </Banner>
      ) : (
        <form className="adm-stack" onSubmit={submit} noValidate>
          <ErrorBanner error={m.error} />
          <TextInput label="Email" type="email" autoComplete="username" value={email} error={errors.email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          <Button type="submit" variant="primary" loading={m.isPending} className="adm-btn--block">
            Send reset link
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

function PasswordPair({
  password,
  confirm,
  onPassword,
  onConfirm,
  errors,
  label = 'New password',
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  errors: FieldErrors;
  label?: string;
}) {
  return (
    <>
      <TextInput label={label} type="password" autoComplete="new-password" hint={PASSWORD_HINT} value={password} error={errors.password} onChange={(e) => onPassword(e.target.value)} />
      <TextInput label="Confirm password" type="password" autoComplete="new-password" value={confirm} error={errors.confirm} onChange={(e) => onConfirm(e.target.value)} />
    </>
  );
}

const confirmError = (password: string, confirm: string): FieldErrors | null => (password !== confirm ? { confirm: 'Passwords do not match' } : null);

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { m, errors, setErrors } = useSessionMutation<{ token: string; password: string }>('/api/admin/auth/reset-password', () =>
    navigate('/admin', { replace: true }),
  );

  if (!token) {
    return (
      <AuthShell title="Link incomplete" footer={<Link to="/admin/forgot">Request a new link</Link>}>
        <p>This reset link is missing its token. Open the link from the email again, or request a new one.</p>
      </AuthShell>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (m.isPending) return;
    const body = { token, password };
    const invalid = { ...(validate(ResetPasswordInput, body) ?? {}), ...(confirmError(password, confirm) ?? {}) };
    if (Object.keys(invalid).length) return setErrors(invalid);
    m.mutate(body);
  };

  return (
    <AuthShell title="Choose a new password" footer={<Link to="/admin/login">Back to sign in</Link>}>
      <form className="adm-stack" onSubmit={submit} noValidate>
        <ErrorBanner error={m.error} />
        {errors.token && <Banner tone="warning">This link is invalid or has expired. Request a new one.</Banner>}
        <PasswordPair password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} errors={errors} />
        <Button type="submit" variant="primary" loading={m.isPending} className="adm-btn--block">
          Save password and sign in
        </Button>
      </form>
    </AuthShell>
  );
}

export function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const { m, errors, setErrors } = useSessionMutation<{ token: string; name: string; password: string }>('/api/admin/auth/accept-invite', () =>
    navigate('/admin', { replace: true }),
  );

  if (!token) {
    return (
      <AuthShell title="Invite link incomplete" footer={<Link to="/admin/login">Go to sign in</Link>}>
        <p>This invitation link is missing its token. Open the link from your invitation email again.</p>
      </AuthShell>
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (m.isPending) return;
    const body = { token, name, password };
    const invalid = { ...(validate(AcceptInviteInput, body) ?? {}), ...(confirmError(password, confirm) ?? {}) };
    if (Object.keys(invalid).length) return setErrors(invalid);
    m.mutate(body);
  };

  return (
    <AuthShell title="Join the team" lede="You've been invited to help run the store. Confirm your name and choose a password.">
      <form className="adm-stack" onSubmit={submit} noValidate>
        <ErrorBanner error={m.error} />
        {errors.token && <Banner tone="warning">This invitation is invalid or has expired. Ask for a new one.</Banner>}
        <TextInput label="Your name" autoComplete="name" value={name} error={errors.name} onChange={(e) => setName(e.target.value)} autoFocus />
        <PasswordPair password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} errors={errors} label="Password" />
        <Button type="submit" variant="primary" loading={m.isPending} className="adm-btn--block">
          Accept invitation
        </Button>
      </form>
    </AuthShell>
  );
}

export function SetupPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ setupToken: '', name: '', email: '', password: '' });
  const [confirm, setConfirm] = useState('');
  const { m, errors, setErrors } = useSessionMutation<typeof form>('/api/admin/auth/setup', () => navigate('/admin', { replace: true }));
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (m.isPending) return;
    const invalid = { ...(validate(AdminSetupInput, form) ?? {}), ...(confirmError(form.password, confirm) ?? {}) };
    if (Object.keys(invalid).length) return setErrors(invalid);
    m.mutate(form);
  };

  return (
    <AuthShell
      title="Set up your store admin"
      lede="No staff accounts exist yet. Create the owner account — it has every permission and can invite the rest of the team."
    >
      <form className="adm-stack" onSubmit={submit} noValidate>
        <ErrorBanner error={m.error} />
        <TextInput
          label="Setup token"
          type="password"
          autoComplete="off"
          value={form.setupToken}
          error={errors.setupToken}
          hint="The SETUP_TOKEN secret configured on the Worker (wrangler secret put SETUP_TOKEN, or .dev.vars locally). It proves you control the deployment."
          onChange={(e) => set('setupToken')(e.target.value)}
          autoFocus
        />
        <TextInput label="Owner name" autoComplete="name" value={form.name} error={errors.name} onChange={(e) => set('name')(e.target.value)} />
        <TextInput label="Owner email" type="email" autoComplete="username" value={form.email} error={errors.email} onChange={(e) => set('email')(e.target.value)} />
        <PasswordPair password={form.password} confirm={confirm} onPassword={set('password')} onConfirm={setConfirm} errors={errors} label="Password" />
        <Button type="submit" variant="primary" loading={m.isPending} className="adm-btn--block">
          Create owner account
        </Button>
      </form>
    </AuthShell>
  );
}
