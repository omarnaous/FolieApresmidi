import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { imageSrc, patch, type MediaDTO } from '../../lib/contract';
import { moveItem } from '../../lib/util';
import { Button, IconButton } from '../../ui/Button';
import { ErrorBanner } from '../../ui/feedback';
import { Textarea } from '../../ui/form';
import { IconChevronLeft, IconChevronRight, IconEdit, IconTrash } from '../../ui/icons';
import { Card } from '../../ui/layout';
import { ImageUploader } from '../../ui/media';
import { Modal } from '../../ui/Modal';
import { useToast } from '../../ui/Toasts';

export function MediaCard({
  media,
  onChange,
  onAdd,
  onAltSaved,
  error,
}: {
  media: MediaDTO[];
  onChange: (next: MediaDTO[]) => void;
  onAdd: (items: MediaDTO[]) => void;
  onAltSaved: (m: MediaDTO) => void;
  error?: string;
}) {
  const [editing, setEditing] = useState<MediaDTO | null>(null);
  return (
    <Card title="Media" actions={media.length ? <span className="adm-muted adm-small">{media.length} / 50</span> : undefined}>
      {media.length > 0 && (
        <ul className="adm-mediagrid">
          {media.map((m, i) => (
            <li key={m.id} className="adm-mediagrid__item">
              <img
              decoding="async" src={imageSrc(m, 320)} alt={m.alt} loading="lazy" />
              {i === 0 && <span className="adm-mediagrid__cover">Cover</span>}
              {!m.alt && <span className="adm-mediagrid__warn">No alt text</span>}
              <div className="adm-mediagrid__tools">
                <IconButton label={`Move image ${i + 1} earlier`} disabled={i === 0} onClick={() => onChange(moveItem(media, i, i - 1))}>
                  <IconChevronLeft size={14} />
                </IconButton>
                <IconButton label={`Move image ${i + 1} later`} disabled={i === media.length - 1} onClick={() => onChange(moveItem(media, i, i + 1))}>
                  <IconChevronRight size={14} />
                </IconButton>
                <IconButton label={`Edit alt text for image ${i + 1}`} onClick={() => setEditing(m)}>
                  <IconEdit size={14} />
                </IconButton>
                <IconButton label={`Remove image ${i + 1} from product`} tone="danger" onClick={() => onChange(media.filter((x) => x.id !== m.id))}>
                  <IconTrash size={14} />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      {media.length < 50 && <ImageUploader onUploaded={onAdd} />}
      {error && <p className="adm-field__error">{error}</p>}
      {editing && <AltTextModal key={editing.id} media={editing} onClose={() => setEditing(null)} onSaved={onAltSaved} />}
    </Card>
  );
}

function AltTextModal({ media, onClose, onSaved }: { media: MediaDTO; onClose: () => void; onSaved: (m: MediaDTO) => void }) {
  const formId = useId();
  const toast = useToast();
  const [alt, setAlt] = useState(media.alt);
  const save = useMutation({
    mutationFn: (value: string) => patch<MediaDTO>(`/api/admin/media/${media.id}`, { alt: value }),
    onSuccess: (dto) => {
      onSaved(dto);
      toast.success('Alt text saved');
      onClose();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!save.isPending) save.mutate(alt.trim());
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Image alt text"
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
      <form id={formId} className="adm-stack" onSubmit={submit}>
        <ErrorBanner error={save.error} />
        <img
              decoding="async" src={imageSrc(media, 640)} alt="" className="adm-altpreview" />
        <Textarea
          label="Alt text"
          rows={3}
          maxLength={300}
          value={alt}
          hint="Describe the image for people using screen readers, e.g. “Ivory linen shirt, front view”. Saved immediately."
          onChange={(e) => setAlt(e.target.value)}
          data-autofocus
        />
      </form>
    </Modal>
  );
}
