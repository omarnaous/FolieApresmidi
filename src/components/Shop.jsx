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
  const prefetch = usePrefetchProductList();

  // every collection on the menu becomes a tab here, the way the catalogue
  // has them, in the owner's saved order (Collections → reorder). A shopper
  // can move between them.
  const tabs = useMemo(
    () => (store?.menu ?? []).filter((m) => m.collectionHandle).map((m) => ({ value: m.collectionHandle, label: m.label })),
    [store?.menu],
  );
  // the shelf opens on the FIRST collection in that saved order — so dragging a
  // collection to the top in the admin changes which drop leads here, not only
  // the tab strip. With no menu set, the featured collection stands in.
  const drop = tabs[0]?.value ?? store?.featuredCollectionHandle ?? null;

  const [active, setActive] = useState(null);
  // open on the leading drop; a shopper's own tab pick is then left alone
  useEffect(() => { setActive(drop); }, [drop]);

  // the selected tab's collection names the section and carries its season
  // line, so the title and subtitle follow whichever drop is being looked at.
  // The tab's own label titles it at once; the collection load only adds the
  // subtitle, so the heading never flickers on a tab change.
  const shown = active ?? drop;
  const current = useCollection(shown);
  const copy = store?.home?.boutique;
  const shownLabel = tabs.find((t) => t.value === shown)?.label;
  const heading = copy?.heading || (shownLabel ?? current.data?.title ?? store?.name ?? ' ');

  return (
    <section className="section shell has-shelf" id="boutique">
      <div className="sec-head">
        <div>
          <div className="label muted" style={{ marginBottom: 14 }}>{eyebrow}</div>
          <h2 className="display d-md">{emphasis(heading)}</h2>
          {copy?.intro ? <p className="sec-sub">{copy.intro}</p>
            : current.data?.subtitle && <p className="sec-sub">{current.data.subtitle}</p>}
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
