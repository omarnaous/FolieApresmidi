import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { put, get, post, type AdminNewsletterDTO, type MediaDTO, type NewsletterSendDTO, type SubscriberDTO } from '../lib/contract';
import { apiFieldErrors, type FieldErrors } from '../lib/forms';
import { fmtDate } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { Button, ButtonLink } from '../ui/Button';
import { Badge, EmptyState, ErrorBanner, QueryState } from '../ui/feedback';
import { Textarea, TextInput } from '../ui/form';
import { Card, PageHeader } from '../ui/layout';
import { SiteFileField } from '../ui/SiteFile';
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
 * footer, and anyone who ticked the box at checkout — and the letters the
 * house writes to it.
 *
 * Joining still sends nobody anything. A letter goes out only when it is
 * written here and sent, and every copy carries its own way off the list.
 */
export default function NewsletterPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [show, setShow] = useState<Show>('subscribed');
  const q = useDebounced(search.trim(), 250);

  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [testTo, setTestTo] = useState('');
  const [attachment, setAttachment] = useState<MediaDTO | null>(null);
  const [sendErrors, setSendErrors] = useState<FieldErrors>({});
  const [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false);

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
  const subscribed = list.data?.subscribers.subscribed ?? 0;

  const send = useMutation({
    mutationFn: (input: { subject: string; body: string; cursor?: string; testTo?: string; attachmentMediaId?: string }) =>
      post<NewsletterSendDTO>('/api/admin/newsletter/send', input),
    onError: (err) => setSendErrors(apiFieldErrors(err)),
  });

  /**
   * The list, a batch at a time. The Worker may make fifty subrequests per
   * request and each letter is one of them, so it hands back a cursor and we
   * come round again — counting up as we go, so a long list does not look
   * like a page that has stopped.
   */
  const runSend = async (one: string | null) => {
    setSendErrors({});
    setBusy(true);
    setProgress(one ? 'Sending…' : 'Starting…');
    try {
      let cursor: string | undefined;
      let sent = 0;
      let failed = 0;
      do {
        const r = await send.mutateAsync({
          subject: subject.trim(),
          body: body.trim(),
          ...(attachment ? { attachmentMediaId: attachment.id } : {}),
          ...(one ? { testTo: one } : {}),
          ...(cursor ? { cursor } : {}),
        });
        sent += r.sent;
        failed += r.failed;
        cursor = r.nextCursor ?? undefined;
        if (!one) setProgress(`${sent.toLocaleString()} of ${r.total.toLocaleString()} sent${failed ? ` · ${failed} refused` : ''}`);
      } while (cursor);
      if (one) {
        setProgress('');
        toast.success(`Sent to ${one}`);
      } else {
        setProgress(`Finished — ${sent.toLocaleString()} sent${failed ? `, ${failed} refused` : ''}`);
        toast.success(`Written to ${sent.toLocaleString()} ${sent === 1 ? 'person' : 'people'}`);
      }
    } catch {
      setProgress('');
      // the banner above the form carries what the server said
    } finally {
      setBusy(false);
    }
  };

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
      <Card title="Write to the list">
        <div className="adm-stack">
          <ErrorBanner error={send.error} title="That did not go out" />
          {progress && (
            <p className="adm-muted adm-small" role="status">
              {progress}
            </p>
          )}
          <TextInput
            label="Subject"
            value={subject}
            maxLength={150}
            error={sendErrors.subject}
            placeholder="The afternoon collection is here"
            onChange={(e) => setSubject(e.target.value)}
          />
          <Textarea
            label="Letter"
            value={body}
            rows={9}
            maxLength={20000}
            error={sendErrors.body}
            hint="Plain words. A blank line starts a new paragraph; the shop's own header, button and unsubscribe line are added around them."
            onChange={(e) => setBody(e.target.value)}
          />
          <SiteFileField
            label="Attachment"
            kind="pdf"
            value={attachment}
            error={sendErrors.attachmentMediaId}
            hint="A look book or a price list, sent with the letter. Optional."
            onChange={setAttachment}
          />
          <div className="adm-row">
            <TextInput
              label="Send one to"
              optional
              value={testTo}
              error={sendErrors.testTo}
              placeholder="you@example.com"
              hint="Read it yourself first. Nobody on the list is written to."
              onChange={(e) => setTestTo(e.target.value)}
              className="adm-filters__grow"
            />
            <Button disabled={busy || !subject.trim() || !body.trim() || !testTo.trim()} onClick={() => void runSend(testTo.trim())}>
              Send a test
            </Button>
          </div>
          <div className="adm-row">
            <Button
              variant="primary"
              disabled={busy || !subject.trim() || !body.trim() || subscribed === 0}
              onClick={() => {
                if (confirm(`Write to ${subscribed.toLocaleString()} ${subscribed === 1 ? 'person' : 'people'}? This cannot be taken back.`)) void runSend(null);
              }}
            >
              {busy ? 'Sending…' : `Send to ${subscribed.toLocaleString()} on the list`}
            </Button>
          </div>
        </div>
      </Card>

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
