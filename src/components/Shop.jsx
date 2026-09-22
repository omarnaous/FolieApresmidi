import React, { useEffect, useMemo, useState } from 'react';
import { useEyebrow } from '../data/sections';
import { emphasis } from '../lib/emphasis';
import Shelf from './Shelf';
import ShelfTabs from './ShelfTabs';
import { homeGridQuery, useCollection, usePrefetchProductList, useStore } from '../lib/queries';

/**
 * The boutique: up to ten ready-to-wear pieces on a shelf under the drop's
 * name.
 *
 * The shelf is the drop, and the tab over it is the drop's own title —
 * whichever collection the owner has made the featured one in the admin.
 * No name is written down here; change the drop there and this follows it.
 *
 * The categories are not gone, only not offered here: a shopper looking for
 * a kind of thing finds Dresses, Tops and the rest inside "See all", which
 * opens the full catalogue, and the accessories keep a section and tabs of
 * their own.
 */
export default function Shop({ onOpen, onAll }) {
  const eyebrow = useEyebrow('#boutique');
  const { data: store } = useStore();
  const featured = useCollection(store?.featuredCollectionHandle);
  const prefetch = usePrefetchProductList();

  // the owner's own title wins; with none, the drop names the section
  const copy = store?.home?.boutique;
  const heading = copy?.heading || ((store?.featuredCollectionHandle && !featured.isError ? featured.data?.title : store?.name) ?? ' ');

  // the drop names itself: one tab, carrying the featured collection's title
  const drop = store?.featuredCollectionHandle ?? null;
  const tabs = useMemo(
    () => (featured.data ? [{ value: featured.data.handle, label: featured.data.title }] : []),
    [featured.data],
  );

  const [active, setActive] = useState(null);
  useEffect(() => { setActive(drop); }, [drop]);

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
          onPreview={(c) => prefetch(homeGridQuery(c, false))}
          controls="shelf-wear"
          label="Filter ready-to-wear"
        />
      </div>
      <Shelf
        id="shelf-wear"
        collection={active}
        accessory={false}
        label="Ready-to-wear"
        onOpen={onOpen}
        onAll={onAll}
      />
    </section>
  );
}
