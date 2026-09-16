import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { del, patch, PERMISSIONS, post, StaffInviteInput, StaffUpdateInput, type Permission, type StaffDTO, type StaffInviteResultDTO } from '../lib/contract';
import { apiFieldErrors, validate, type FieldErrors } from '../lib/forms';
import { fmtDateTime, fmtRelative, type Tone } from '../lib/format';
import { useCopy } from '../lib/hooks';
import { qk, useStaffList } from '../lib/queries';
import { useStaff } from '../lib/session';
import { Button, IconButton } from '../ui/Button';
import { Badge, Banner, EmptyState, ErrorBanner, QueryState } from '../ui/feedback';
import { ChoiceGroup, TextInput } from '../ui/form';
import { IconCopy, IconEdit, IconPlus, IconTrash } from '../ui/icons';
import { Card, PageHeader } from '../ui/layout';
import { ConfirmDialog, Modal } from '../ui/Modal';
import { DataTable } from '../ui/Table';
import { useToast } from '../ui/Toasts';

const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', staff: 'Staff' } as const;
const STATUS_META: Record<StaffDTO['status'], { label: string; tone: Tone }> = {
  invited: { label: 'Invited', tone: 'info' },
  active: { label: 'Active', tone: 'success' },
  disabled: { label: 'Disabled', tone: 'warning' },
};

const PERMISSION_GROUPS: { area: string; perms: { value: Permission; label: string }[] }[] = [
  { area: 'Dashboard', perms: [{ value: 'dashboard:read', label: 'View dashboard & reports' }] },
  {
    area: 'Orders',
    perms: [
      { value: 'orders:read', label: 'View orders' },
      { value: 'orders:write', label: 'Fulfil, edit & cancel orders' },
      { value: 'orders:refund', label: 'Issue refunds' },
    ],
  },
  {
    area: 'Products',
    perms: [
      { value: 'products:read', label: 'View products & collections' },
      { value: 'products:write', label: 'Edit products, collections, media & stock' },
    ],
  },
  {
    area: 'Customers',
    perms: [
      { value: 'customers:read', label: 'View customers' },
      { value: 'customers:write', label: 'Edit customers & notes' },
    ],
  },
  {
    area: 'Discounts',
    perms: [
      { value: 'discounts:read', label: 'View discounts' },
      { value: 'discounts:write', label: 'Create & edit discounts' },
    ],
  },
  {
    area: 'Store',
    perms: [
      { value: 'shipping:write', label: 'Shipping zones & rates' },
      { value: 'taxes:write', label: 'Taxes' },
      { value: 'pages:write', label: 'Pages & policies' },
      { value: 'settings:write', label: 'Store settings' },
    ],
  },
  { area: 'Team', perms: [{ value: 'staff:manage', label: 'Manage staff & view the audit log' }] },
];

/** Granting write implies read; removing read removes the rest of that area. */
function togglePermission(list: Permission[], perm: Permission, on: boolean): Permission[] {
  const set = new Set(list);
  const [area, level] = perm.split(':');
  const read = `${area}:read`;
  if (on) {
    set.add(perm);
    const readPerm = PERMISSIONS.find((p) => p === read);
    if (level !== 'read' && readPerm) set.add(readPerm);
  } else {
    set.delete(perm);
    if (level === 'read') PERMISSIONS.filter((p) => p.startsWith(`${area}:`)).forEach((p) => set.delete(p));
  }
  return PERMISSIONS.filter((p) => set.has(p));
}

function PermissionsEditor({ value, onChange, error }: { value: Permission[]; onChange: (v: Permission[]) => void; error?: string }) {
  return (
    <div className="adm-stack-sm">
      <p className="adm-field__label">Permissions</p>
      <div className="adm-perms">
        {PERMISSION_GROUPS.map((g) => (
          <fieldset key={g.area} className="adm-perms__group">
            <legend>{g.area}</legend>
            {g.perms.map((p) => (
              <label key={p.value} className="adm-checklist__row">
                <input type="checkbox" checked={value.includes(p.value)} onChange={(e) => onChange(togglePermission(value, p.value, e.target.checked))} />
                <span>{p.label}</span>
              </label>
            ))}
          </fieldset>
        ))}
      </div>
      {error && <p className="adm-field__error">{error}</p>}
    </div>
  );
}

const ROLE_OPTIONS = [
  { value: 'admin' as const, label: 'Admin', description: 'Everything, including staff management.' },
  { value: 'staff' as const, label: 'Staff', description: 'Only the permissions you choose.' },
];

export default function StaffPage() {
  const me = useStaff();
  const q = useStaffList();
  const qc = useQueryClient();
  const toast = useToast();
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<StaffDTO | null>(null);
  const [removing, setRemoving] = useState<StaffDTO | null>(null);

  const remove = useMutation({
    mutationFn: (s: StaffDTO) => del<void>(`/api/admin/staff/${s.id}`),
    onSuccess: (_d, s) => {
      void qc.invalidateQueries({ queryKey: qk.staff });
      void qc.invalidateQueries({ queryKey: qk.audit });
      toast.success(`${s.name} removed`);
      setRemoving(null);
    },
  });

  const invite = (
    <Button variant="primary" icon={<IconPlus size={15} />} onClick={() => setInviting(true)}>
      Invite staff
    </Button>
  );

  return (
    <>
      <PageHeader title="Staff" actions={invite} />
      <Card flush>
        {q.data ? (
          q.data.length === 0 ? (
            <EmptyState title="No staff yet" body="Invite people to help run the store." action={invite} />
          ) : (
            <DataTable
              caption="Staff accounts"
              rows={q.data}
              rowKey={(s) => s.id}
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  sort: (a, b) => a.name.localeCompare(b.name),
                  cell: (s) => (
                    <span className="adm-row adm-row--tight">
                      <span className="adm-strong">{s.name}</span>
                      {s.id === me.id && <Badge tone="accent">You</Badge>}
                    </span>
                  ),
                },
                { key: 'email', header: 'Email', cell: (s) => s.email, sort: (a, b) => a.email.localeCompare(b.email) },
                {
                  key: 'role',
                  header: 'Role',
                  cell: (s) => (
                    <span className="adm-cellstack">
                      <span>{ROLE_LABEL[s.role]}</span>
                      {s.role === 'staff' && <span className="adm-muted adm-small">{s.permissions.length} permissions</span>}
                    </span>
                  ),
                },
                { key: 'status', header: 'Status', cell: (s) => <Badge tone={STATUS_META[s.status].tone}>{STATUS_META[s.status].label}</Badge> },
                {
                  key: 'last',
                  header: 'Last login',
                  sort: (a, b) => (a.lastLoginAt ?? 0) - (b.lastLoginAt ?? 0),
                  cell: (s) => <span title={s.lastLoginAt ? fmtDateTime(s.lastLoginAt) : undefined}>{fmtRelative(s.lastLoginAt)}</span>,
                },
                {
                  key: 'actions',
                  header: 'Actions',
                  hideHeader: true,
                  align: 'right',
                  cell: (s) =>
                    s.role === 'owner' ? (
                      <span className="adm-muted adm-small">Store owner</span>
                    ) : s.id === me.id ? (
                      <span className="adm-muted adm-small">Your account</span>
                    ) : (
                      <span className="adm-row adm-row--tight adm-row--end">
                        <IconButton label={`Edit ${s.name}`} onClick={() => setEditing(s)}>
                          <IconEdit />
                        </IconButton>
                        <IconButton label={`Remove ${s.name}`} tone="danger" onClick={() => setRemoving(s)}>
                          <IconTrash />
                        </IconButton>
                      </span>
                    ),
                },
              ]}
            />
          )
        ) : (
          <div className="adm-card__pad">
            <QueryState error={q.error} isPending={q.isPending} onRetry={() => void q.refetch()} />
          </div>
        )}
      </Card>

      {inviting && <InviteModal onClose={() => setInviting(false)} />}
      {editing && <EditStaffModal key={editing.id} staff={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!removing}
        onClose={() => {
          setRemoving(null);
          remove.reset();
        }}
        title={`Remove ${removing?.name ?? 'staff member'}?`}
        body="They are signed out everywhere and lose access immediately. Their past actions stay in the audit log."
        confirmLabel="Remove"
        tone="danger"
        pending={remove.isPending}
        error={remove.error}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const formId = useId();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'staff'>('staff');
  const [permissions, setPermissions] = useState<Permission[]>(['dashboard:read', 'orders:read']);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [result, setResult] = useState<StaffInviteResultDTO | null>(null);
  const [copied, copy] = useCopy();

  const send = useMutation({
    mutationFn: (body: { name: string; email: string; role: 'admin' | 'staff'; permissions: Permission[] }) => post<StaffInviteResultDTO>('/api/admin/staff/invite', body),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: qk.staff });
      toast.success(`Invitation sent to ${res.staff.email}`);
      if (res.inviteUrl) setResult(res);
      else onClose();
    },
    onError: (err) => setErrors(apiFieldErrors(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (send.isPending) return;
    const body = { name, email, role, permissions: role === 'staff' ? permissions : [] };
    const invalid = validate(StaffInviteInput, body);
    if (invalid) return setErrors(invalid);
    setErrors({});
    send.mutate(body);
  };

  if (result?.inviteUrl) {
    const url = result.inviteUrl;
    return (
      <Modal open onClose={onClose} title="Invitation created" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
        <div className="adm-stack">
          <Banner tone="info">
            <p>
              Email delivery is in development mode, so share this link with {result.staff.name} directly. It works once and expires.
            </p>
          </Banner>
          <div className="adm-inviteurl">
            <TextInput label="Invite link" labelHidden readOnly value={url} onFocus={(e) => e.target.select()} className="adm-grow" />
            <Button icon={<IconCopy size={14} />} onClick={() => copy(url)} aria-live="polite">
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Invite staff"
      size="lg"
      dismissible={!send.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={send.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={send.isPending}>
            Send invitation
          </Button>
        </>
      }
    >
      <form id={formId} className="adm-stack" onSubmit={submit} noValidate>
        <ErrorBanner error={send.error} />
        <div className="adm-grid adm-grid--2">
          <TextInput label="Name" value={name} error={errors.name} onChange={(e) => setName(e.target.value)} data-autofocus />
          <TextInput label="Email" type="email" value={email} error={errors.email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <ChoiceGroup label="Role" value={role} onChange={setRole} options={ROLE_OPTIONS} />
        {role === 'staff' && <PermissionsEditor value={permissions} onChange={setPermissions} error={errors.permissions} />}
      </form>
    </Modal>
  );
}

function EditStaffModal({ staff, onClose }: { staff: StaffDTO; onClose: () => void }) {
  const formId = useId();
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(staff.name);
  const [role, setRole] = useState<'admin' | 'staff'>(staff.role === 'staff' ? 'staff' : 'admin');
  const [permissions, setPermissions] = useState<Permission[]>(staff.role === 'staff' ? staff.permissions : []);
  const [status, setStatus] = useState<'active' | 'disabled'>(staff.status === 'disabled' ? 'disabled' : 'active');
  const [errors, setErrors] = useState<FieldErrors>({});

  const save = useMutation({
    mutationFn: (body: { name: string; role: 'admin' | 'staff'; permissions: Permission[]; status?: 'active' | 'disabled' }) => patch<StaffDTO>(`/api/admin/staff/${staff.id}`, body),
    onSuccess: (dto) => {
      void qc.invalidateQueries({ queryKey: qk.staff });
      void qc.invalidateQueries({ queryKey: qk.audit });
      toast.success(`${dto.name} updated`);
      onClose();
    },
    onError: (err) => setErrors(apiFieldErrors(err)),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (save.isPending) return;
    const body = { name, role, permissions: role === 'staff' ? permissions : [], ...(staff.status === 'invited' ? {} : { status }) };
    const invalid = validate(StaffUpdateInput, body);
    if (invalid) return setErrors(invalid);
    setErrors({});
    save.mutate(body);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit ${staff.name}`}
      size="lg"
      dismissible={!save.isPending}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} className="adm-stack" onSubmit={submit} noValidate>
        <ErrorBanner error={save.error} />
        <div className="adm-grid adm-grid--2">
          <TextInput label="Name" value={name} error={errors.name} onChange={(e) => setName(e.target.value)} data-autofocus />
          <TextInput label="Email" value={staff.email} readOnly disabled hint="Staff change their own email." />
        </div>
        <ChoiceGroup label="Role" value={role} onChange={setRole} options={ROLE_OPTIONS} />
        {role === 'staff' && <PermissionsEditor value={permissions} onChange={setPermissions} error={errors.permissions} />}
        {staff.status === 'invited' ? (
          <p className="adm-muted">This invitation hasn't been accepted yet.</p>
        ) : (
          <ChoiceGroup
            label="Access"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'active', label: 'Active', description: 'Can sign in.' },
              { value: 'disabled', label: 'Disabled', description: 'Signed out and blocked from signing in.' },
            ]}
          />
        )}
      </form>
    </Modal>
  );
}
