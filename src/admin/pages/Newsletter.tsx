import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { put, get, type AdminNewsletterDTO, type SubscriberDTO } from '../lib/contract';
import { apiFieldErrors, type FieldErrors } from '../lib/forms';
import { fmtDate } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { Button, ButtonLink } from '../ui/Button';
import { Badge, EmptyState, ErrorBanner, QueryState } from '../ui/feedback';
import { TextInput } from '../ui/form';
import { Card, PageHeader } from '../ui/layout';
import { DataTable } from '../ui/Table';
import { useToast } from '../ui/Toasts';

type Show = 'subscribed' | 'unsubscribed' | 'all';
const SHOW: { value: Show; label: string }[] = [
  { value: 'subscribed', label: 'On the list' },
  { value: 'unsubscribed', label: 'Left' },
  { value: 'all', label: 'Everyone' },
];

/** A file the owner can open in Numbers or hand to whoever sends the letter. */
const csv = (rows: SubscriberDTO[]) =>
  ['email,status,source,joined', ...rows.map((r) => [r.email, r.status, r.source, new Date(r.createdAt).toISOString()].join(','))].join('\n');

/**
 * The list of addresses the site has gathered — the newsletter field in the
 * footer, and anyone who ticked the box at checkout. Nothing is sent from
 * this screen: the only email the shop sends a shopper is the confirmation
 * of an order. This is where the addresses are kept until the house decides
 * to write, and it hands them over as a file whenever you ask.
 */
export default function NewsletterPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<Show>('subscribed');
  const q = useDebounced(search.trim(), 250);

  const list = useQuery({
    queryKey: ['admin', 'newsletter', q, show] as const,
    queryFn: ({ signal }) => get<AdminNewsletterDTO>('/api/admin/newsletter', { q: q || undefined, show, limit: 500 }, signal),
  });

  const welcome = list.data?.welcome ?? null;
  const [code, setCode] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  // the saved code is the starting point, and follows a save or a reload
  useEffect(() => setCode(welcome?.code ?? ''), [welcome?.code]);

  const saveCode = useMutation({
    mutationFn: () => put<AdminNewsletterDTO>('/api/admin/newsletter/code', { code: code.trim() || null }),
    onSuccess: (dto) => {
      setErrors({});
      void qc.invalidateQueries({ queryKey: ['admin', 'newsletter'] });
      toast.success(dto.welcome ? `New subscribers are shown ${dto.welcome.code}` : 'New subscribers are shown no code');
    },
    onError: (err) => setErrors(apiFieldErrors(err)),
  });

  const rows = list.data?.items ?? [];
  const file = useMemo(() => (rows.length ? URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv' })) : ''), [rows]);

  return (
    <>
      <PageHeader
        title="Newsletter"
        meta={
          list.data
            ? `${list.data.subscribers.subscribed.toLocaleString()} on the list · ${list.data.subscribers.unsubscribed.toLocaleString()} left`
            : undefined
        }
        actions={
          rows.length > 0 ? (
            <ButtonLink to={file} native download={`fdm-list-${new Date().toISOString().slice(0, 10)}.csv`} size="sm">
              Download CSV
            </ButtonLink>
          ) : undefined
        }
      />
      {/* No email goes out for joining, so this is how the offer is kept: the
          code is printed on the page the moment the address is given. */}
      <Card title="What they are shown for joining">
        <div className="adm-stack">
          <ErrorBanner error={saveCode.error} title="That was not saved" />
          <div className="adm-row">
            <TextInput
              label="Discount code"
              optional
              value={code}
              maxLength={64}
              error={errors.code}
              placeholder="NEWSLETTER15"
              hint="The code whoever subscribes is shown on the spot, to copy and use at checkout. Leave it empty to show none."
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="adm-filters__grow"
            />
            <Button
              variant="primary"
              disabled={saveCode.isPending || code.trim() === (welcome?.code ?? '')}
              onClick={() => saveCode.mutate()}
            >
              Save
            </Button>
          </div>
          <p className="adm-field__hint">
            {welcome?.active
              ? `Worth ${welcome.offer} — shown as soon as someone joins.`
              : welcome
                ? `${welcome.code} is switched off or expired under Discounts, so nothing is shown until it is live again.`
                : 'Nothing is shown for joining. Pick a code from Discounts to make the list worth something.'}
          </p>
        </div>
      </Card>

      <Card flush>
        {list.data ? (
          <>
            <div className="adm-filters">
              <TextInput
                label="Search addresses"
                labelHidden
                type="search"
                placeholder="Search by address"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="adm-filters__grow"
              />
              <div className="adm-seggroup" role="group" aria-label="Show">
                {SHOW.map((s) => (
                  <button key={s.value} type="button" className="adm-seg" aria-pressed={show === s.value} onClick={() => setShow(s.value)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="adm-card__pad adm-field__hint">
              Addresses gathered from the site. The shop sends them nothing — only the confirmation of an order goes out — so this is a list to
              keep, and to take with you when you have something to say.
            </p>
            {rows.length === 0 ? (
              <EmptyState
                compact
                title={q ? 'No address matches' : show === 'unsubscribed' ? 'Nobody has left' : 'Nobody has joined yet'}
                body={q ? undefined : 'The field in the footer of the shop is where they sign up.'}
              />
            ) : (
              <DataTable
                caption="The list"
                rows={rows}
                rowKey={(r) => r.email}
                columns={[
                  {
                    key: 'email',
                    header: 'Address',
                    cell: (r) => <span className="adm-link-strong">{r.email}</span>,
                    sort: (a, b) => a.email.localeCompare(b.email),
                  },
                  {
                    key: 'status',
                    header: 'State',
                    cell: (r) => (r.status === 'subscribed' ? <Badge tone="success">On the list</Badge> : <Badge tone="neutral">Left</Badge>),
                  },
                  { key: 'source', header: 'From', cell: (r) => <span className="adm-muted">{r.source === 'checkout' ? 'Checkout' : 'The footer'}</span> },
                  {
                    key: 'joined',
                    header: 'Joined',
                    align: 'right',
                    cell: (r) => fmtDate(r.createdAt),
                    sort: (a, b) => a.createdAt - b.createdAt,
                  },
                ]}
                footer={
                  <span className="adm-muted adm-small">
                    {rows.length.toLocaleString()} shown
                    {list.data.nextCursor ? ' · narrow the search to see the rest' : ''}
                  </span>
                }
              />
            )}
          </>
        ) : (
          <div className="adm-card__pad">
            <QueryState error={list.error} isPending={list.isPending} onRetry={() => void list.refetch()} />
          </div>
        )}
      </Card>
    </>
  );
}
