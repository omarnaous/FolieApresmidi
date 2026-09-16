import React, { useMemo } from 'react';
import { Link } from 'react-router';
import Reveal from './Reveal';
import { useCollection, useStore } from '../lib/queries';
import { instagramHandle } from '../lib/store';

const LINK = { fontSize: 14, color: 'var(--bone-70)' };

export default function Footer() {
  const { data: store } = useStore();
  const { data: featured } = useCollection(store?.featuredCollectionHandle);
  const ig = instagramHandle(store?.contact.instagram);
  const email = store?.contact.email;

  /* The store's own categories, the drop first, split over two columns. */
  const cols = useMemo(() => {
    const links = (store?.menu ?? [])
      .filter((m) => m.collectionHandle)
      .map((m) => ({ label: m.label, handle: m.collectionHandle }));
    if (featured && !links.some((l) => l.handle === featured.handle)) {
      links.unshift({ label: featured.title, handle: featured.handle });
    }
    const half = Math.ceil(links.length / 2);
    return [
      { t: 'Boutique', l: links.slice(0, half) },
      { t: 'Also', l: links.slice(half) },
    ];
  }, [store, featured]);

  return (
    <footer className="foot">
      <div className="shell">
        <div className="foot-cols">
          <div className="foot-col">
            <div className="label">Follies d'Après-Midi</div>
            <p className="lede" style={{ color: 'var(--bone-70)', fontSize: 15, maxWidth: '34ch' }}>
              Luxury prêt-à-porter, designed and produced in limited quantities in Lebanon.
              Épicée. Libre.
            </p>
            {ig && (
              <a
                className="label link-u"
                href={`https://instagram.com/${ig}`}
                target="_blank"
                rel="noreferrer noopener"
                data-cursor="Instagram"
              >
                @{ig} ↗
              </a>
            )}
          </div>

          {cols.map((c) => (
            <div className="foot-col" key={c.t}>
              <div className="label">{c.t}</div>
              {c.l.map((x) => (
                <Link className="link-u" key={x.handle} to={`/collections/${x.handle}`} style={LINK}>{x.label}</Link>
              ))}
            </div>
          ))}

          <div className="foot-col">
            <div className="label">Client care</div>
            {email && (
              <a className="link-u" href={`mailto:${email}`} style={LINK} data-cursor="Email">
                {email}
              </a>
            )}
            {(store?.policies ?? []).map((p) => (
              <Link className="link-u" key={p.handle} to={`/pages/${p.handle}`} style={LINK}>{p.title}</Link>
            ))}
            <span className="label muted" style={{ color: 'var(--bone-40)', lineHeight: 1.8 }}>
              Exchanges within 24 hours.<br />No refunds.
            </span>
          </div>
        </div>
      </div>

      <div className="shell">
        <Reveal variant="rv-mask" className="foot-word">FOLLIES</Reveal>
      </div>

      <div className="shell">
        <div className="foot-base label">
          <span>© {new Date().getFullYear()} Follies d'Après-Midi</span>
          <span>Beirut — 33.8938° N, 35.5018° E</span>
          <span>Built with React &amp; Remotion</span>
        </div>
      </div>
    </footer>
  );
}
