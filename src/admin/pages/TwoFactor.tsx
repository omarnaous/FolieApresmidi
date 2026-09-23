import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  post,
  TwoFactorEnableInput,
  type AdminSessionDTO,
  type TwoFactorEnabledDTO,
  type TwoFactorSetupDTO,
} from '../lib/contract';
import { apiFieldErrors, validate, type FieldErrors } from '../lib/forms';
import { useCopy } from '../lib/hooks';
import { qk } from '../lib/queries';
import { useStaff } from '../lib/session';
import { Button } from '../ui/Button';
import { Badge, Banner, ErrorBanner } from '../ui/feedback';
import { TextInput } from '../ui/form';
import { Card } from '../ui/layout';
import { useToast } from '../ui/Toasts';

/**
 * Two-factor, for the signed-in account.
 *
 * Off, it offers to set up: a secret to type into an authenticator app, then a
 * code from the app to prove the pairing before it is switched on. Turning it
 * on hands back ten backup codes, shown once. On, it offers to switch off,
 * behind the account's own password.
 *
 * No QR code is drawn — every authenticator app takes a typed key, and drawing
 * one would mean pulling in a library. The secret is grouped for the eye and
 * copyable in a tap.
 */
export function TwoFactorCard() {
  const me = useStaff();
  const qc = useQueryClient();
  const toast = useToast();
  const [, copy] = useCopy();

  const [setup, setSetup] = useState<TwoFactorSetupDTO | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const begin = useMutation({
    mutationFn: () => post<TwoFactorSetupDTO>('/api/admin/auth/2fa/setup', {}),
    onSuccess: (dto) => { setSetup(dto); setErrors({}); },
  });

  const enable = useMutation({
    mutationFn: (body: { code: string }) => post<TwoFactorEnabledDTO>('/api/admin/auth/2fa/enable', body),
    onMutate: () => setErrors({}),
    onSuccess: (dto) => {
      setBackupCodes(dto.backupCodes);
      setSetup(null);
      setCode('');
      void qc.invalidateQueries({ queryKey: qk.session });
      void qc.invalidateQueries({ queryKey: qk.staff });
    },
    onError: (err) => setErrors(apiFieldErrors(err)),
  });

  const disable = useMutation({
    mutationFn: (body: { password: string }) => post<AdminSessionDTO>('/api/admin/auth/2fa/disable', body),
    onMutate: () => setErrors({}),
    onSuccess: (session) => {
      qc.setQueryData(qk.session, session);
      void qc.invalidateQueries({ queryKey: qk.staff });
      setDisabling(false);
      setPassword('');
      toast.success('Two-factor turned off');
    },
    onError: (err) => setErrors(apiFieldErrors(err)),
  });

  // the codes screen — shown once, after enabling
  if (backupCodes) {
    return (
      <Card title="Save your backup codes">
        <div className="adm-stack">
          <Banner tone="warning">
            These are shown once. Keep them somewhere safe — each lets you sign in once if you lose your phone.
          </Banner>
          <ul className="adm-backup">
            {backupCodes.map((c) => <li key={c} className="adm-mono">{c}</li>)}
          </ul>
          <div className="adm-row">
            <Button onClick={() => copy(backupCodes.join('\n'))}>Copy all</Button>
            <Button variant="primary" onClick={() => { setBackupCodes(null); toast.success('Two-factor is on'); }}>
              I have saved them
            </Button>
          </div>
        </div>
      </Card>
    );
  }

  if (me.twoFactorEnabled) {
    return (
      <Card title="Two-factor authentication">
        <div className="adm-stack">
          <p className="adm-row adm-row--tight">
            <Badge tone="success">On</Badge>
            <span className="adm-muted">A code from your authenticator app is required every time you sign in.</span>
          </p>
          {disabling ? (
            <>
              <ErrorBanner error={disable.error} />
              <TextInput
                label="Confirm your password to turn it off"
                type="password"
                autoComplete="current-password"
                value={password}
                error={errors.password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="adm-row">
                <Button onClick={() => { setDisabling(false); setPassword(''); setErrors({}); }}>Cancel</Button>
                <Button variant="danger" loading={disable.isPending} onClick={() => disable.mutate({ password })}>
                  Turn off two-factor
                </Button>
              </div>
            </>
          ) : (
            <div><Button variant="danger" onClick={() => setDisabling(true)}>Turn off</Button></div>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card title="Two-factor authentication">
      <div className="adm-stack">
        <p className="adm-muted">
          Add a code from an authenticator app on top of your password, so a stolen password is not enough to sign in.
        </p>
        {!setup ? (
          <div><Button variant="primary" loading={begin.isPending} onClick={() => begin.mutate()}>Set up two-factor</Button></div>
        ) : (
          <>
            <ol className="adm-steps">
              <li>Open an authenticator app — Google Authenticator, Authy, 1Password.</li>
              <li>
                Add an account by entering this setup key:
                <span className="adm-secret">
                  <code className="adm-mono">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
                  <button type="button" className="adm-link" onClick={() => copy(setup.secret)}>Copy</button>
                </span>
              </li>
              <li>Enter the six-digit code it shows:</li>
            </ol>
            <ErrorBanner error={enable.error} />
            <TextInput
              label="Code from the app"
              labelHidden
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              error={errors.code}
              onChange={(e) => setCode(e.target.value)}
            />
            <div className="adm-row">
              <Button onClick={() => { setSetup(null); setCode(''); setErrors({}); }}>Cancel</Button>
              <Button
                variant="primary"
                loading={enable.isPending}
                onClick={() => {
                  const body = { code: code.trim() };
                  const invalid = validate(TwoFactorEnableInput, body);
                  if (invalid) return setErrors(invalid);
                  enable.mutate(body);
                }}
              >
                Turn on two-factor
              </Button>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
