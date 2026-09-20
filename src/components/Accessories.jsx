import React, { useState } from 'react';
import { useEyebrow } from '../data/sections';
import Shelf from './Shelf';
import ShelfTabs from './ShelfTabs';
import { ACCESSORIES } from '../data/accessories';
import { emphasis } from '../lib/emphasis';
import { homeGridQuery, useCollection, usePrefetchProductList, useStore } from '../lib/queries';

/**
 * The accessories: the parent collection as "All", and the collections
 * inside it as tabs — each shown only if it exists and has pieces, under its
 * own title. The boutique keeps these handles off its own tabs, so a piece
 * is never offered in both sections.
 */
export default function Accessories({ onOpen, onAll }) {
  const eyebrow = useEyebrow('#accessories');
  // the title and subtitle are the owner's, from the admin Home page
  const copy = useStore().data?.home?.accessories;
  const prefetch = usePrefetchProductList();

  // ACCESSORIES.parts is a module constant, so these are the same hooks in the same order every render
  const parts = ACCESSORIES.parts.map((handle) => useCollection(handle)); // eslint-disable-line react-hooks/rules-of-hooks
  const tabs = [
    { value: ACCESSORIES.handle, label: 'All' },
    ...parts.filter((q) => q.data && q.data.productsCount > 0).map((q) => ({ value: q.data.handle, label: q.data.title })),
  ];
  const [active, setActive] = useState(ACCESSORIES.handle);

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
          value={active}
          onChange={setActive}
          onPreview={(c) => prefetch(homeGridQuery(c))}
          controls="shelf-accessories"
          label="Filter accessories"
        />
      </div>
      <Shelf
        id="shelf-accessories"
        collection={active}
        label="Accessories"
        allNoun="accessories"
        onOpen={onOpen}
        onAll={onAll}
      />
    </section>
  );
}
