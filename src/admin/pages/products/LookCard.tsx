import { useState } from 'react';
import { imageSrc, LOOK_MAX, type AdminLookPieceDTO, type AdminProductListItemDTO } from '../../lib/contract';
import { moveItem } from '../../lib/util';
import { Button, IconButton } from '../../ui/Button';
import { ProductStatusBadge } from '../../ui/feedback';
import { IconArrowDown, IconArrowUp, IconPlus, IconTrash } from '../../ui/icons';
import { Card } from '../../ui/layout';
import { ProductPicker } from '../../ui/Pickers';
import { Thumb } from '../../ui/Table';

const toPiece = (p: AdminProductListItemDTO): AdminLookPieceDTO => ({ id: p.id, handle: p.handle, title: p.title, status: p.status, image: p.image });

/**
 * Shop the look: the pieces shown under this product in the store, in this
 * order. Left empty, the store suggests pieces from the same collections.
 */
export function LookCard({
  pieces,
  productId,
  onChange,
  error,
}: {
  pieces: AdminLookPieceDTO[];
  /** this product, which cannot be picked for its own look (null while new) */
  productId: string | null;
  onChange: (next: AdminLookPieceDTO[]) => void;
  error?: string;
}) {
  const [picking, setPicking] = useState(false);
  const room = LOOK_MAX - pieces.length;

  return (
    <Card
      title="Shop the look"
      actions={
        room > 0 ? (
          <Button size="sm" icon={<IconPlus size={14} />} onClick={() => setPicking(true)}>
            Add pieces
          </Button>
        ) : (
          <span className="adm-muted adm-small">
            {pieces.length} / {LOOK_MAX}
          </span>
        )
      }
    >
      <p className="adm-field__hint">
        Shown under this product as “Shop the look”, in this order — up to {LOOK_MAX} pieces. Pieces with nothing to choose can be added to
        the bag straight from there.
      </p>
      {pieces.length === 0 ? (
        <p className="adm-muted adm-gap-top">No pieces chosen. The store suggests some from other categories in the same collections.</p>
      ) : (
        <ol className="adm-orderlist adm-orderlist--inset adm-gap-top">
          {pieces.map((p, i) => (
            <li key={p.id} className="adm-orderlist__item">
              <span className="adm-orderlist__pos">{i + 1}</span>
              <Thumb src={p.image ? imageSrc(p.image, 320) : null} size={44} />
              <span className="adm-orderlist__title">
                {p.title}
                {p.status !== 'active' && <span className="adm-muted adm-small adm-block">Not shown in the store until it is active</span>}
              </span>
              <ProductStatusBadge status={p.status} />
              <span className="adm-row adm-row--tight">
                <IconButton label={`Move ${p.title} up`} disabled={i === 0} onClick={() => onChange(moveItem(pieces, i, i - 1))}>
                  <IconArrowUp size={14} />
                </IconButton>
                <IconButton label={`Move ${p.title} down`} disabled={i === pieces.length - 1} onClick={() => onChange(moveItem(pieces, i, i + 1))}>
                  <IconArrowDown size={14} />
                </IconButton>
                <IconButton label={`Remove ${p.title} from the look`} tone="danger" onClick={() => onChange(pieces.filter((x) => x.id !== p.id))}>
                  <IconTrash size={14} />
                </IconButton>
              </span>
            </li>
          ))}
        </ol>
      )}
      {error && <p className="adm-field__error">{error}</p>}
      <ProductPicker
        open={picking}
        onClose={() => setPicking(false)}
        title="Add pieces to the look"
        max={room}
        excludeIds={productId ? [productId, ...pieces.map((p) => p.id)] : pieces.map((p) => p.id)}
        onSelect={(items) => onChange([...pieces, ...items.slice(0, room).map(toPiece)])}
      />
    </Card>
  );
}
