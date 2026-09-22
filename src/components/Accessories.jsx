import React, { useMemo, useState } from 'react';
import { useEyebrow } from '../data/sections';
import Shelf from './Shelf';
import ShelfTabs from './ShelfTabs';
import { emphasis } from '../lib/emphasis';
import { homeGridQuery, useCollection, usePrefetchProductList, useStore } from '../lib/queries';

/**
 * The accessories: the pieces the house has marked as accessories, on a
 * shelf of their own under the drop's name — the same shape as the boutique
 * above it.
 *
 * What is an accessory is a thing said about the piece itself, ticked in the
 * admin, not a guess made from the collections it happens to sit in. So a
 * collection can be renamed, emptied or deleted and the jewellery stays
 * exactly where it is.
 */
export default function Accessories({ onOpen, onAll }) {
  const eyebrow = useEyebrow('#accessories');
  // the title and subtitle are the owner's, from the admin Home page
  const store = useStore().data;
  const copy = store?.accessories ?? store?.home?.accessories;
  const prefetch = usePrefetchProductList();

  // the drop names itself, exactly as the boutique's does
  const drop = useCollection(store?.featuredCollectionHandle);
  const tabs = useMemo(
    () => (drop.data ? [{ value: drop.data.handle, label: drop.data.title }] : []),
    [drop.data],
  );
  const [active, setActive] = useState(null);

  return (
    <section className="section shell has-shelf" id="accessories">
      <div className="sec-head">
        <div>
          <div className="label muted" style={{ marginBottom: 14 }}>{eyebrow}</div>
          <h2 className="display d-md">{copy ? emphasis(copy.heading) : '\u00a0'}</h2>
          {copy?.intro && <p className="sec-sub">{copy.intro}</p>}
        </div>
        <ShelfTabs
          options={tabs}
          value={active ?? drop.data?.handle ?? null}
          onChange={setActive}
          onPreview={(c) => prefetch(homeGridQuery(c, true))}
          controls="shelf-accessories"
          label="Filter accessories"
        />
      </div>
      <Shelf
        id="shelf-accessories"
        collection={active ?? drop.data?.handle ?? null}
        accessory
        label="Accessories"
        allNoun="accessories"
        onOpen={onOpen}
        onAll={onAll}
      />
    </section>
  );
}
