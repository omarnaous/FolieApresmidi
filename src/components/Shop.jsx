import React, { useMemo, useState } from 'react';
import { useEyebrow } from '../data/sections';
import { emphasis } from '../lib/emphasis';
import { ACCESSORY_HANDLES } from '../data/accessories';
import Shelf from './Shelf';
import ShelfTabs from './ShelfTabs';
import { homeGridQuery, useCollection, usePrefetchProductList, useStore } from '../lib/queries';

/**
 * The boutique: up to ten ready-to-wear pieces on a shelf under the drop's
 * name, with words for tabs. Accessories have a section of their own, so
 * their collections are kept off these tabs. "See all" goes to the full
 * catalogue for what is showing.
 */
export default function Shop({ onOpen, onAll }) {
  const eyebrow = useEyebrow('#boutique');
  const { data: store } = useStore();
  const featured = useCollection(store?.featuredCollectionHandle);
  const prefetch = usePrefetchProductList();

  // the owner's own title wins; with none, the drop names the section
  const copy = store?.home?.boutique;
  const heading = copy?.heading || ((store?.featuredCollectionHandle && !featured.isError ? featured.data?.title : store?.name) ?? ' ');

  const tabs = useMemo(
    () => (store?.menu ?? [])
      .filter((m) => !ACCESSORY_HANDLES.has(m.collectionHandle))
      .map((m) => ({ value: m.collectionHandle, label: m.label })),
    [store?.menu],
  );
  const [active, setActive] = useState(null);

  return (
    <section className="section shell has-shelf" id="boutique">
      <div className="sec-head">
        <div>
          <div className="label muted" style={{ marginBottom: 14 }}>{eyebrow}</div>
          <h2 className="display d-md">{emphasis(heading)}</h2>
          {copy?.intro && <p className="sec-sub">{copy.intro}</p>}
        </div>
        <ShelfTabs
          options={tabs}
          value={active}
          onChange={setActive}
          onPreview={(c) => prefetch(homeGridQuery(c))}
          controls="shelf-wear"
          label="Filter ready-to-wear"
        />
      </div>
      <Shelf
        id="shelf-wear"
        collection={active}
        label="Ready-to-wear"
        onOpen={onOpen}
        onAll={onAll}
      />
    </section>
  );
}
