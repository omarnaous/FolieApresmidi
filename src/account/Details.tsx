import { useState, type FormEvent } from 'react';
import { ChangePasswordInput, UpdateAccountInput, type CustomerDTO } from '../../shared/api';
import { messageFor, zodFields } from '../lib/errors';
import { useChangePassword, useResendVerification, useUpdateAccount } from '../lib/queries';
import { CheckField, FormAlert, TextField } from '../ui/fields';
import { useFormErrors } from '../ui/useFormErrors';

const idFor = (field: string) => `acct-${field}`;
const DETAIL_ORDER = ['name', 'phone'];
const PASSWORD_ORDER = ['currentPassword', 'newPassword'];

export function Details({ customer }: { customer: CustomerDTO }) {
  const update = useUpdateAccount();
  const change = useChangePassword();
  const resend = useResendVerification();

  const [values, setValues] = useState({
    name: customer.name,
    phone: customer.phone ?? '',
    acceptsMarketing: customer.acceptsMarketing,
  });
  const [saved, setSaved] = useState(false);
  const details = useFormErrors(DETAIL_ORDER, idFor);

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [changed, setChanged] = useState(false);
  const password = useFormErrors(PASSWORD_ORDER, idFor);

  const saveDetails = (e: FormEvent) => {
    e.preventDefault();
    if (update.isPending) return;
    const parsed = UpdateAccountInput.safeParse({
      name: values.name,
      phone: values.phone.trim() || null,
      acceptsMarketing: values.acceptsMarketing,
    });
    if (!parsed.success) { details.show(zodFields(parsed.error)); return; }
    details.clear();
    update.mutate(parsed.data, { onSuccess: () => setSaved(true), onError: (err) => details.fail(err) });
  };

  const changePassword = (e: FormEvent) => {
    e.preventDefault();
    if (change.isPending) return;
    const parsed = ChangePasswordInput.safeParse(pw);
    if (!parsed.success) { password.show(zodFields(parsed.error)); return; }
    password.clear();
    change.mutate(parsed.data, {
      onSuccess: () => { setChanged(true); setPw({ currentPassword: '', newPassword: '' }); },
      onError: (err) => password.fail(err, 'That is not your current password.'),
    });
  };

  return (
    <div className="acct-details">
      {!customer.emailVerified && (
        <div className="co-alert">
          <span className="label">Your email is not verified yet</span>
          <p>Open the link we sent to {customer.email}, or ask for a new one.</p>
          <div aria-live="polite">
            <button
              className="label link-u"
              onClick={() => resend.mutate()}
              disabled={resend.isPending || resend.isSuccess}
            >
              {resend.isSuccess ? 'Sent — check your inbox' : resend.isPending ? 'Sending…' : 'Resend verification'}
            </button>
            {resend.isError && <span className="co-err label"> {messageFor(resend.error)}</span>}
          </div>
        </div>
      )}

      <form className="acct-form" onSubmit={saveDetails} noValidate>
        <h2 className="display d-sm">Details</h2>
        <dl className="co-rows">
          <div className="co-row"><dt>Email</dt><dd>{customer.email}</dd></div>
        </dl>
        <div className="co-fields">
          <TextField
            id={idFor('name')} label="Full name" plain autoComplete="name"
            value={values.name} error={details.errors.name}
            onChange={(e) => { setValues((v) => ({ ...v, name: e.target.value })); details.clear('name'); setSaved(false); }}
          />
          <TextField
            id={idFor('phone')} label="Phone" optional type="tel" autoComplete="tel" placeholder="+961 …"
            value={values.phone} error={details.errors.phone}
            onChange={(e) => { setValues((v) => ({ ...v, phone: e.target.value })); details.clear('phone'); setSaved(false); }}
          />
          <CheckField
            id={idFor('marketing')} label="Tell me about drops and pop-ups" wide
            checked={values.acceptsMarketing}
            onChange={(acceptsMarketing) => { setValues((v) => ({ ...v, acceptsMarketing })); setSaved(false); }}
          />
        </div>
        <FormAlert message={details.alert} />
        <div className="co-actions">
          <button type="submit" className="btn solid" disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save details'}
          </button>
          <span className="label muted" role="status">{saved ? 'Saved.' : ''}</span>
        </div>
      </form>

      <form className="acct-form" onSubmit={changePassword} noValidate>
        <h2 className="display d-sm">Password</h2>
        <div className="co-fields">
          <TextField
            id={idFor('currentPassword')} label="Current password" plain type="password" autoComplete="current-password"
            value={pw.currentPassword} error={password.errors.currentPassword}
            onChange={(e) => { setPw((v) => ({ ...v, currentPassword: e.target.value })); password.clear('currentPassword'); setChanged(false); }}
          />
          <TextField
            id={idFor('newPassword')} label="New password" plain type="password" autoComplete="new-password"
            hint="At least 10 characters"
            value={pw.newPassword} error={password.errors.newPassword}
            onChange={(e) => { setPw((v) => ({ ...v, newPassword: e.target.value })); password.clear('newPassword'); setChanged(false); }}
          />
        </div>
        <FormAlert message={password.alert} />
        <div className="co-actions">
          <button type="submit" className="btn" disabled={change.isPending}>
            {change.isPending ? 'Changing…' : 'Change password'}
          </button>
          <span className="label muted" role="status">{changed ? 'Your password is changed.' : ''}</span>
        </div>
      </form>
    </div>
  );
}
