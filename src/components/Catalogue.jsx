import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import ProductCard from './ProductCard';
import { CardSkeletons } from '../ui/Skeleton';
import { featuredIn } from '../lib/catalog';
import { useCollection, useMoney, useProducts, useStore, useSuggest } from '../lib/queries';
import { parseCatalogue } from '../lib/routes';
import { useEscape, useLinger } from '../hooks/useSheet';

const SORTS = [
  { key: 'featured', label: 'Featured' },
  { key: 'price_asc', label: 'Price ↑' },
  { key: 'price_desc', label: 'Price ↓' },
  { key: 'title_asc', label: 'A–Z' },
];
// only offered while there is something to be relevant to
const RELEVANCE = { key: 'relevance', label: 'Relevance' };

const PAGE = 24;

/** The catalogue's URL for a collection and a set of refinements — the URL is the state. */
function catalogueUrl(handle, { q, sort, options, available }) {
  const p = new URLSearchParams();
  if (q) p.set('q', q);
  if (sort) p.set('sort', sort);
  options.forEach((o) => p.append('option', o));
  if (available) p.set('available', '1');
  const s = p.toString();
  const base = handle !== 'all' ? `/collections/${handle}` : q ? '/search' : '/collections/all';
  return s ? `${base}?${s}` : base;
}

export default function Catalogue({ path, top, onClose, onOpen }) {
  const open = !!path;
  // hold the last URL while the sheet slides away
  const current = useLinger(path, 820);
  const navigate = useNavigate();
  const location = useLocation();
  const money = useMoney();
  const { data: store } = useStore();
  const input = useRef(null);

  const view = useMemo(() => {
    const { handle, params } = parseCatalogue(current ?? '/collections/all');
    const q = params.get('q')?.trim() ?? '';
    return {
      handle,
      q,
      sortParam: params.get('sort'),
      sort: params.get('sort') ?? (q ? 'relevance' : 'featured'),
      options: params.getAll('option'),
      available: params.get('available') === '1',
    };
  }, [current]);
  const { handle, q, sort, sortParam, options, available } = view;

  const [text, setText] = useState(q);
  const pushed = useRef(q);

  /* Every refinement rewrites the URL in place, so a shared or refreshed link
     opens on exactly this view and Back still closes the catalogue. */
  const go = useCallback((next, to = handle) => {
    navigate(
      catalogueUrl(to, { q, sort: sortParam, options, available, ...next }),
      { replace: true, state: location.state },
    );
  }, [navigate, location.state, handle, q, sortParam, options, available]);

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
    option: options.length ? options : undefined,
    available: available ? '1' : undefined,
    sort,
    limit: PAGE,
  }), [handle, q, options, available, sort]);

  const list = useProducts(query, { enabled: !!current });
  const collection = useCollection(handle === 'all' ? null : handle);
  const suggest = useSuggest(q);

  const results = useMemo(() => list.data?.pages.flatMap((p) => p.items) ?? [], [list.data]);
  const first = list.data?.pages[0];
  const total = first?.total ?? 0;
  const price = first?.facets.price;

  // a badge on every card marks nothing — see ProductCard
  const mixed = useMemo(
    () => results.some((p) => featuredIn(p, store)) && results.some((p) => !featuredIn(p, store)),
    [results, store],
  );

  /* Facets as the server counts them, plus whatever is already chosen — a
     pick that narrowed its own facet away must still be there to undo. */
  const facets = useMemo(() => {
    const rows = new Map((first?.facets.options ?? []).map((f) => [f.name, f.values.map((v) => v.value)]));
    options.forEach((o) => {
      const at = o.indexOf(':');
      if (at < 1) return;
      const name = o.slice(0, at);
      const value = o.slice(at + 1);
      const values = rows.get(name) ?? [];
      if (!values.includes(value)) rows.set(name, [...values, value]);
    });
    return [...rows].filter(([, values]) => values.length > 0);
  }, [first, options]);

  const toggleOption = (name, value) => {
    const key = `${name}:${value}`;
    go({ options: options.includes(key) ? options.filter((o) => o !== key) : [...options, key] });
  };

  const range = total > 0 && price
    ? price.min === price.max ? money(price.min) : `${money(price.min)} – ${money(price.max)}`
    : null;
  const sorts = q ? [RELEVANCE, ...SORTS] : SORTS;
  const suggestions = (suggest.data?.collections ?? []).filter((c) => c.handle !== handle).slice(0, 3);
  const title = handle === 'all' ? 'All pieces' : collection.data?.title ?? (collection.isError ? 'All pieces' : ' ');

  const reset = () => {
    pushed.current = '';
    setText('');
    navigate('/collections/all', { replace: true, state: location.state });
  };

  return (
    // data-lenis-prevent so the results list and the chip rows still scroll on
    // touch: a stopped Lenis preventDefaults every touchmove it sees.
    <div className={`cat ${open ? 'on' : ''}`} aria-hidden={!open} data-lenis-prevent>
      <div className="cat-bar shell">
        <div className="cat-bar-top">
          <div>
            <div className="label muted">Catalogue</div>
            <h2 className="display d-sm" style={{ marginTop: 6 }}>{title}</h2>
          </div>
          <button className="label link-u" onClick={onClose} data-cursor="Close">Close</button>
        </div>

        <div className="search">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M11 11l4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
          <input
            ref={input}
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Search — a name, a colour, a size, a fabric…"
            aria-label="Search the catalogue"
          />
          {text && <button className="label link-u" onClick={() => setText('')}>Clear</button>}
        </div>

        <div className="cat-controls">
          <div className="filters left">
            {(store?.menu ?? []).map((c) => {
              const to = c.collectionHandle ?? 'all';
              return (
                <button
                  key={to}
                  className={`chip ${handle === to ? 'on' : ''}`}
                  aria-pressed={handle === to}
                  onClick={() => go({ options: [] }, to)}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
          <div className="filters right">
            {sorts.map((s) => (
              <button
                key={s.key}
                className={`chip ${sort === s.key ? 'on' : ''}`}
                aria-pressed={sort === s.key}
                onClick={() => go({ sort: s.key })}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className="filters left cat-refine" aria-label="Refine">
            <button
              className={`chip ${available ? 'on' : ''}`}
              aria-pressed={available}
              onClick={() => go({ available: !available })}
            >
              In stock
            </button>
            {facets.map(([name, values]) => (
              <React.Fragment key={name}>
                <span className="label muted cat-facet">{name}</span>
                {values.map((value) => {
                  const on = options.includes(`${name}:${value}`);
                  return (
                    <button
                      key={value}
                      className={`chip ${on ? 'on' : ''}`}
                      aria-pressed={on}
                      onClick={() => toggleOption(name, value)}
                    >
                      {value}
                    </button>
                  );
                })}
              </React.Fragment>
            ))}
          </div>
        </div>

        <div className="cat-count label muted" aria-live="polite">
          {list.isPending ? 'Looking…' : `${total} ${total === 1 ? 'piece' : 'pieces'}`}
          {range ? ` · ${range}` : ''}
          {q ? ` · “${q}”` : ''}
          {suggestions.map((c) => (
            <React.Fragment key={c.handle}>
              {' · '}
              <button className="label link-u" onClick={() => go({ q: '', options: [], sort: null }, c.handle)}>
                {c.title}
              </button>
            </React.Fragment>
          ))}
        </div>
      </div>

      <div className="cat-body shell">
        {list.isError && !list.data ? (
          <div className="cat-empty" role="alert">
            <span className="display d-sm">The catalogue did not load.</span>
            <span className="label muted">Check your connection, then try again.</span>
            <button className="btn" onClick={() => list.refetch()}>Try again</button>
          </div>
        ) : list.isPending ? (
          <div className="grid" aria-busy="true"><CardSkeletons count={8} /></div>
        ) : results.length === 0 ? (
          <div className="cat-empty">
            <span className="display d-sm">Nothing under that name.</span>
            <span className="label muted">Try a colour, a category, or clear the search.</span>
            <button className="btn" onClick={reset}>Reset</button>
          </div>
        ) : (
          <>
            <div className="grid" aria-busy={list.isFetching}>
              {results.map((p, i) => (
                <ProductCard key={p.id} product={p} index={i} onOpen={onOpen} showDrop={mixed} />
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
