import { useMemo, useState } from 'react';
import { imageSrc, LOOKBOOK_LINK_MAX } from '../../lib/contract';
import { useStore } from '../../lib/queries';
import { moveItem } from '../../lib/util';
import { Button, IconButton } from '../../ui/Button';
import { IconChevronLeft, IconChevronRight, IconPlus, IconTrash } from '../../ui/icons';
import { Card } from '../../ui/layout';
import { Modal } from '../../ui/Modal';
import { LOOKBOOK } from '../../../data/lookbook';

const thumb = (url: string, w = 320) => imageSrc({ url }, w);

/**
 * The look book as the shop shows it: the owner's own photographs once any are
 * set on the Home page, the house's seed set until then.
 */
function useLookbookUrls(): string[] {
  const images = useStore().data?.home?.lookbook?.images;
  return useMemo(() => (images && images.length ? images.map((m) => m.url) : (LOOKBOOK as string[])), [images]);
}

/**
 * Look-book photographs paired with this piece. They show on its product page
 * as "In the look book", in this order.
 */
export function LookbookCard({ urls, onChange, error }: { urls: string[]; onChange: (next: string[]) => void; error?: string }) {
  const [picking, setPicking] = useState(false);
  const room = LOOKBOOK_LINK_MAX - urls.length;

  return (
    <Card
      title="Look book"
      actions={
        room > 0 ? (
          <Button size="sm" icon={<IconPlus size={14} />} onClick={() => setPicking(true)}>
            Choose from look book
          </Button>
        ) : (
          <span className="adm-muted adm-small">
            {urls.length} / {LOOKBOOK_LINK_MAX}
          </span>
        )
      }
    >
      <p className="adm-field__hint">
        Photographs from the look book that show this piece. They appear on its product page under “In the look book”, in this order — up to{' '}
        {LOOKBOOK_LINK_MAX}.
      </p>
      {urls.length === 0 ? (
        <p className="adm-muted adm-gap-top">None chosen yet.</p>
      ) : (
        <ul className="adm-mediagrid adm-gap-top">
          {urls.map((url, i) => (
            <li key={url} className="adm-mediagrid__item">
              <img decoding="async" src={thumb(url)} alt="" loading="lazy" />
              <div className="adm-mediagrid__tools">
                <IconButton label={`Move photograph ${i + 1} earlier`} disabled={i === 0} onClick={() => onChange(moveItem(urls, i, i - 1))}>
                  <IconChevronLeft size={14} />
                </IconButton>
                <IconButton label={`Move photograph ${i + 1} later`} disabled={i === urls.length - 1} onClick={() => onChange(moveItem(urls, i, i + 1))}>
                  <IconChevronRight size={14} />
                </IconButton>
                <IconButton label={`Remove photograph ${i + 1}`} tone="danger" onClick={() => onChange(urls.filter((u) => u !== url))}>
                  <IconTrash size={14} />
                </IconButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="adm-field__error">{error}</p>}
      {picking && (
        <LookbookPicker
          chosen={urls}
          room={room}
          onClose={() => setPicking(false)}
          onAdd={(picked) => {
            onChange([...urls, ...picked.slice(0, room)]);
            setPicking(false);
          }}
        />
      )}
    </Card>
  );
}

/** Every look-book photograph; tap to tick, then add the ticked ones. */
function LookbookPicker({ chosen, room, onClose, onAdd }: { chosen: string[]; room: number; onClose: () => void; onAdd: (urls: string[]) => void }) {
  const all = useLookbookUrls();
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (url: string) =>
    setPicked((p) => (p.includes(url) ? p.filter((u) => u !== url) : p.length < room ? [...p, url] : p));

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Choose from the look book"
      footer={
        <>
          <span className="adm-muted adm-small adm-grow">
            {picked.length} of {room} chosen
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!picked.length} onClick={() => onAdd(picked)}>
            {picked.length ? `Add ${picked.length}` : 'Add'}
          </Button>
        </>
      }
    >
      <ul className="adm-libgrid adm-lbpick">
        {all.map((url, i) => {
          const already = chosen.includes(url);
          const on = picked.includes(url);
          return (
            <li key={url}>
              <button
                type="button"
                className={`adm-libgrid__item adm-lbpick__item${on ? ' is-on' : ''}${already ? ' is-taken' : ''}`}
                aria-pressed={on}
                aria-label={`Look ${i + 1}${already ? ' (already on this piece)' : ''}`}
                disabled={already || (!on && picked.length >= room)}
                onClick={() => toggle(url)}
              >
                <img decoding="async" src={thumb(url)} alt="" loading="lazy" />
                {(on || already) && <span className="adm-lbpick__tick" aria-hidden="true">{already ? '✓' : picked.indexOf(url) + 1}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
