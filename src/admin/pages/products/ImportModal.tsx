import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { api, get, type CsvImportDTO } from '../../lib/contract';
import { qk } from '../../lib/queries';
import { Button, Spinner } from '../../ui/Button';
import { Badge, Banner, ErrorBanner } from '../../ui/feedback';
import { Modal } from '../../ui/Modal';

/** CSV upload → poll GET /imports/:id every 1.5s until it finishes. */
export function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [importId, setImportId] = useState<string | null>(null);

  const upload = useMutation({
    mutationFn: (f: File) => {
      const fd = new FormData();
      fd.append('file', f);
      return api<CsvImportDTO>('/api/admin/products/import', { method: 'POST', body: fd });
    },
    onSuccess: (dto) => {
      qc.setQueryData(qk.csvImport(dto.id), dto);
      setImportId(dto.id);
    },
  });

  const job = useQuery({
    queryKey: qk.csvImport(importId ?? ''),
    queryFn: ({ signal }) => get<CsvImportDTO>(`/api/admin/imports/${importId}`, undefined, signal),
    enabled: !!importId,
    staleTime: 0,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'completed' || s === 'failed' ? false : 1500;
    },
  });

  const status = job.data?.status;
  useEffect(() => {
    if (status === 'completed') void qc.invalidateQueries({ queryKey: qk.products });
  }, [status, qc]);

  const reset = () => {
    setFile(null);
    setImportId(null);
    upload.reset();
  };
  const close = () => {
    reset();
    onClose();
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (file && !upload.isPending) upload.mutate(file);
  };

  const done = status === 'completed' || status === 'failed';
  const d = job.data;

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import products from CSV"
      dismissible={!upload.isPending}
      footer={
        importId ? (
          <>
            {done && <Button onClick={reset}>Import another file</Button>}
            <Button variant="primary" onClick={close}>
              {done ? 'Done' : 'Close'}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={close} disabled={upload.isPending}>
              Cancel
            </Button>
            <Button type="submit" form={`${inputId}-form`} variant="primary" loading={upload.isPending} disabled={!file}>
              Upload and import
            </Button>
          </>
        )
      }
    >
      {!importId ? (
        <form id={`${inputId}-form`} className="adm-stack" onSubmit={submit}>
          <p>
            Use the same columns as <a href="/api/admin/products/export.csv" className="adm-link" download>the export</a>. Rows with a matching handle update
            the existing product; new handles create products.
          </p>
          <ErrorBanner error={upload.error} />
          <div className="adm-field">
            <label htmlFor={inputId} className="adm-field__label">
              CSV file
            </label>
            <input id={inputId} type="file" accept=".csv,text/csv" className="adm-file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-autofocus />
          </div>
        </form>
      ) : (
        <div className="adm-stack" aria-live="polite">
          <ErrorBanner error={job.error} onRetry={() => void job.refetch()} />
          {!d || !done ? (
            <div className="adm-row">
              <Spinner label="Importing" />
              <span>{d?.status === 'processing' ? 'Importing rows…' : 'Queued — starting shortly…'}</span>
            </div>
          ) : d.status === 'failed' ? (
            <Banner tone="warning" title="The import failed">
              <p>No changes were applied. Fix the rows below and try again.</p>
            </Banner>
          ) : (
            <Banner tone="success" title="Import complete" />
          )}
          {d?.summary && (
            <div className="adm-row adm-row--wrap">
              <Badge tone="success">{d.summary.created} created</Badge>
              <Badge tone="info">{d.summary.updated} updated</Badge>
              <Badge tone="neutral">{d.summary.skipped} skipped</Badge>
              <span className="adm-muted">{d.summary.rows} rows read</span>
            </div>
          )}
          {d && d.errors.length > 0 && (
            <div className="adm-table-wrap adm-table-wrap--scroll">
              <table className="adm-table">
                <caption className="adm-sr">Row errors</caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ width: '5rem' }}>
                      Row
                    </th>
                    <th scope="col">Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {d.errors.map((err, i) => (
                    <tr key={`${err.row}-${i}`}>
                      <td>{err.row}</td>
                      <td>{err.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
