import { useNavigate } from 'react-router';
import type { ProductDTO } from '../../shared/api';
import ProductCard from '../components/ProductCard';
import { messageFor } from '../lib/errors';
import { useWishlist, useWishlistToggle } from '../lib/queries';
import { LoadError, Loading } from '../ui/States';

export function Wishlist() {
  const list = useWishlist();
  const toggle = useWishlistToggle();
  const navigate = useNavigate();
  // a piece opens over the account; closing it lands back on this list
  const open = (product: ProductDTO) => navigate(`/products/${product.handle}`);

  if (list.isPending) return <Loading label="Finding your saved pieces…" />;
  if (list.isError) {
    return <LoadError title="Your saved pieces did not load." message={messageFor(list.error)} onRetry={() => list.refetch()} />;
  }

  const items = list.data.items;
  if (!items.length) {
    return (
      <div className="acct-state">
        <span className="display d-sm">Nothing saved yet.</span>
        <span className="label muted">Tap Save on a piece to keep it here.</span>
      </div>
    );
  }

  return (
    <>
      {toggle.isError && <p className="co-err label" role="alert">{messageFor(toggle.error)}</p>}
      <div className="grid acct-wish">
        {items.map((p, i) => (
          <div className="acct-wish-item" key={p.id}>
            <ProductCard product={p} index={i} onOpen={open} showDrop={false} />
            <button className="x" onClick={() => toggle.mutate({ product: p, saved: true })}>Remove</button>
          </div>
        ))}
      </div>
    </>
  );
}
