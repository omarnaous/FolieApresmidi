import React, { useMemo, useState } from 'react';
import { eyebrow } from '../data/sections';
import ProductCard from './ProductCard';
import Reveal from './Reveal';
import { CardSkeletons } from '../ui/Skeleton';
import { featuredIn } from '../lib/catalog';
import { homeGridQuery, useCollection, useProductList, useStore } from '../lib/queries';

/** The home grid is a taster, not the catalogue — see /components/Catalogue. */
export default function Shop({ onOpen, onAll }) {
  const { data: store } = useStore();
  const featured = useCollection(store?.featuredCollectionHandle);
  // a collection handle; null is "All"
  const [active, setActive] = useState(null);
  const { data, isPending, isError, isFetching, refetch } = useProductList(homeGridQuery(active));

  const menu = store?.menu ?? [];
  const shown = data?.items ?? [];
  const total = data?.total ?? 0;
  const activeLabel = menu.find((m) => m.collectionHandle === active)?.label;
  // the drop's own title, or the house name if there is no drop to name
  const heading = (store?.featuredCollectionHandle && !featured.isError ? featured.data?.title : store?.name) ?? ' ';

  // the heading already names the drop — only badge cards when the row
  // actually holds both, otherwise every card carries the same sticker
  const mixed = useMemo(
    () => shown.some((p) => featuredIn(p, store)) && shown.some((p) => !featuredIn(p, store)),
    [shown, store],
  );

  return (
    <section className="section shell" id="boutique" style={{ paddingTop: 'clamp(60px, 9vh, 120px)' }}>
      <div className="sec-head">
        <div>
          <div className="label muted" style={{ marginBottom: 14 }}>{eyebrow('#boutique')}</div>
          <h2 className="display d-md">{heading}</h2>
        </div>
        <div className="filters">
          {menu.map((c) => (
            <button
              key={c.collectionHandle ?? 'all'}
              className={`chip ${active === c.collectionHandle ? 'on' : ''}`}
              aria-pressed={active === c.collectionHandle}
              onClick={() => setActive(c.collectionHandle)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {isError && !data ? (
        <div className="cat-empty" role="alert">
          <span className="display d-sm">The boutique did not load.</span>
          <span className="label muted">Check your connection, then try again.</span>
          <button className="btn" onClick={() => refetch()}>Try again</button>
        </div>
      ) : data && shown.length === 0 ? (
        <div className="cat-empty">
          <span className="display d-sm">Nothing here yet.</span>
          <span className="label muted">Produced in limited quantities.</span>
        </div>
      ) : (
        <div className="grid" aria-busy={isFetching}>
          {isPending ? (
            <CardSkeletons count={8} />
          ) : (
            shown.map((p, i) => (
              <ProductCard key={p.id} product={p} index={i} onOpen={onOpen} showDrop={mixed} />
            ))
          )}
        </div>
      )}

      {total > 0 && (
        <Reveal delay={150} className="more">
          <span className="label muted">
            Showing {shown.length} of {total}
            {active === null ? ' pieces' : ` in ${activeLabel}`}
          </span>
          <button className="btn solid" onClick={() => onAll(active)} data-cursor="All">
            See all {total} pieces
          </button>
        </Reveal>
      )}
    </section>
  );
}
