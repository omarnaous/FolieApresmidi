import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import PieceCard, { PieceSkeletons } from './PieceCard';
import ShelfTabs from './ShelfTabs';
import { useCollection, useProducts, useStore } from '../lib/queries';
import { parseCatalogue } from '../lib/routes';
import { useEscape, useLinger } from '../hooks/useSheet';

const PAGE = 24;

/** The catalogue's URL for a collection and a set of refinements — the URL is the state. */
function catalogueUrl(handle, { q, type, sort, options, available, search }) {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (type) p.set('type', type);
  if (sort) p.set('sort', sort);
  options.forEach((o) => p.append('option', o));
  if (available) p.set('available', '1');
  const s = p.toString();
  // clearing a search stays in the search view, not the filtered collection
  const base = handle !== 'all' ? `/collections/${handle}` : q || search ? '/search' : '/collections/all';
  return s ? `${base}?${s}` : base;
}

export default function Catalogue({ path, top, onClose, onOpen }) {
  const open = !!path;
  // hold the last URL while the sheet slides away
  const current = useLinger(path, 820);
  const navigate = useNavigate();
  const location = useLocation();
  const { data: store } = useStore();
  const input = useRef(null);

  const view = useMemo(() => {
    const { base, handle, params } = parseCatalogue(current ?? '/collections/all');
    const q = params.get('q')?.trim() ?? '';
    return {
      base,
      handle,
      q,
      sortParam: params.get('sort'),
      sort: params.get('sort') ?? (q ? 'relevance' : 'featured'),
      // the subcollection: Tops, Jackets… within the collection, or within the search
      type: params.get('type') ?? '',
      options: params.getAll('option'),
      available: params.get('available') === '1',
    };
  }, [current]);
  const { handle, q, type, sort, sortParam, options, available } = view;
  // the plain search — reached by the search icon — is just a field and its
  // results: no collection tabs.
  const isSearch = view.base === '/search';

  const [text, setText] = useState(q);
  const pushed = useRef(q);

  /* Every refinement rewrites the URL in place, so a shared or refreshed link
     opens on exactly this view and Back still closes the catalogue. */
  const go = useCallback((next, to = handle) => {
    navigate(
      catalogueUrl(to, { q, type, sort: sortParam, options, available, search: isSearch, ...next }),
      { replace: true, state: location.state },
    );
  }, [navigate, location.state, handle, q, type, sortParam, options, available, isSearch]);

  // the URL moved without us (opened afresh, the back button): the field follows it
  useEffect(() => {
    if (q !== pushed.current) { pushed.current = q; setText(q); }
  }, [q]);

  // typing settles for a beat before it becomes a search
  useEffect(() => {
    if (!top) return;
    const next = text.trim();
    if (next === q) return;
    const t = setTimeout(() => {
      pushed.current = next;
      go({ q: next, sort: !next && sortParam === 'relevance' ? null : sortParam });
    }, 250);
    return () => clearTimeout(t);
  }, [text, q, top, go, sortParam]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => input.current?.focus(), 700);
    return () => clearTimeout(t);
  }, [open]);

  useEscape(top, onClose);

  const query = useMemo(() => ({
    collection: handle === 'all' ? undefined : handle,
    q: q || undefined,
    type: type || undefined,
    option: options.length ? options : undefined,
    available: available ? '1' : undefined,
    sort,
    limit: PAGE,
  }), [handle, q, type, options, available, sort]);

  // a plain search shows nothing until something is typed — no query, no grid
  const armed = !!current && !(isSearch && !q);
  const list = useProducts(query, { enabled: armed });
  const collection = useCollection(handle === 'all' ? null : handle);

  const results = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const first = list.data?.pages[0];
  const total = first?.total ?? 0;

  /* The collections row: the catalogue is looked at a collection at a time,
     so there is no "All" tab — everything is reached from the menu's "View
     all", and then no tab is lit. A collection reached by a link but not on
     the menu still gets a tab, so the row always says where you are. */
  const tabs = useMemo(() => {
    const rows = (store?.menu ?? []).filter((c) => c.collectionHandle).map((c) => ({ value: c.collectionHandle, label: c.label }));
    if (handle !== 'all' && !rows.some((t) => t.value === handle) && collection.data) rows.push({ value: handle, label: collection.data.title });
    return rows;
  }, [store?.menu, handle, collection.data]);

  /* The subcollections under the collections — only the ones what is being
     looked at has pieces in, in the owner's order — plus the one chosen, so
     it can be undone. The same in a collection, in View all and in a search. */
  const categories = useMemo(() => {
    const rows = (first?.facets.productTypes ?? []).map((r) => r.value);
    if (type && !rows.some((r) => r.toLowerCase() === type.toLowerCase())) rows.push(type);
    return rows;
  }, [first, type]);
  // "View all" reached from a subcollection in the menu is named after it
  const title = isSearch
    ? 'Search'
    : handle === 'all'
      ? type || 'All pieces'
      : collection.data?.title ?? (collection.isError ? 'All pieces' : ' ');

  const reset = () => {
    pushed.current = '';
    setText('');
    navigate(isSearch ? '/search' : '/collections/all', { replace: true, state: location.state });
  };

  return (
    // data-lenis-prevent so the results list and the option rows still scroll on
    // touch: a stopped Lenis preventDefaults every touchmove it sees.
    <div className={`cat ${open ? 'on' : ''} ${isSearch ? 'is-search' : ''}`} aria-hidden={!open} data-lenis-prevent>
      <div className="cat-bar shell">
        <div className="cat-bar-top">
          <div>
            <div className="label muted">{isSearch ? 'Search' : 'Catalogue'}</div>
            <h2 className="display d-sm" style={{ marginTop: 6 }}>{title}</h2>
            {!isSearch && collection.data?.subtitle && (
              <p className="cat-subtitle label">{collection.data.subtitle}</p>
            )}
          </div>
          <button className="label link-u" onClick={onClose} data-cursor="Close">Close</button>
        </div>

        <div className="cat-search">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.2" />
            <path d="M11 11l4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <input
            ref={input}
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search — a name, a colour, a size, a fabric…"
            aria-label="Search the catalogue"
          />
          {text && <button type="button" className="label link-u" onClick={() => setText('')}>Clear</button>}
        </div>

        {/* the collections, then their subcollections under them — the only
            filters, in a collection, in View all and in a search alike; the
            chosen subcollection carries over from one collection to the next */}
        <ShelfTabs
          options={tabs}
          value={handle}
          onChange={(to) => go({ options: [], available: false }, to)}
          controls="cat-results"
          label="Collections"
        />

        {categories.length > 0 && (
          <div className="opts cat-types" role="group" aria-label="Subcollections">
            {['', ...categories].map((value) => {
              const on = value ? value.toLowerCase() === type.toLowerCase() : !type;
              return (
                <button
                  key={value || 'all'}
                  type="button"
                  className={`opt ${on ? 'on' : ''}`}
                  aria-pressed={on}
                  onClick={() => go({ type: value })}
                >
                  {value || 'All'}
                </button>
              );
            })}
          </div>
        )}

        {/* no count on screen; a screen reader still hears how many came back */}
        <p className="sr-only" aria-live="polite">
          {armed && !list.isPending ? `${total} ${total === 1 ? 'piece' : 'pieces'}` : ''}
        </p>
      </div>

      <div className="cat-body shell" id="cat-results">
        {isSearch && !q ? (
          <div className="cat-empty cat-prompt">
            <span className="display d-sm">What are you looking for?</span>
            <span className="label muted">A name, a colour, a size, a fabric.</span>
          </div>
        ) : list.isError && !list.data ? (
          <div className="cat-empty" role="alert">
            <span className="display d-sm">The catalogue did not load.</span>
            <span className="label muted">Check your connection, then try again.</span>
            <button className="btn" onClick={() => list.refetch()}>Try again</button>
          </div>
        ) : list.isPending ? (
          <div className="grid cat-grid" aria-busy="true"><PieceSkeletons count={8} /></div>
        ) : results.length === 0 ? (
          <div className="cat-empty">
            <span className="display d-sm">Nothing under that name.</span>
            <span className="label muted">Try a colour, a category, or clear the search.</span>
            <button className="btn" onClick={reset}>Reset</button>
          </div>
        ) : (
          <>
            <div className="grid cat-grid" aria-busy={list.isFetching}>
              {/* Results are the answer to a question that has just been
                  asked: they come in together, not a scroll at a time. A
                  reveal tied to the viewport left everything below the fold
                  blank until it was scrolled to. */}
              {results.map((p, i) => (
                <div className="cat-in" key={p.id} style={{ '--n': i % 8 }}>
                  <PieceCard product={p} index={i} onOpen={onOpen} showDrop={false} price={!isSearch} showTag={!isSearch} />
                </div>
              ))}
            </div>
            {(list.hasNextPage || list.isFetchNextPageError) && (
              <div className="more">
                <span className="label muted">Showing {results.length} of {total}</span>
                {list.isFetchNextPageError && (
                  <span className="co-err label" role="alert">The next pieces did not load. Try again.</span>
                )}
                <button className="btn" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
                  {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
