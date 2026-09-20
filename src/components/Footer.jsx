import React from 'react';
import { Link } from 'react-router';
import Reveal from './Reveal';
import { useStore } from '../lib/queries';
import { instagramHandle } from '../lib/store';

const LINK = { fontSize: 14, color: 'var(--bone-70)' };

/**
 * The foot of the house. The navigation lives in the bar and the menu, so
 * nothing is repeated here: what is left is how to reach the house — the
 * list, the address it answers from, its policies, its Instagram and its
 * telephone — each of them shown only if the owner has filled it in.
 */
export default function Footer({ inert }) {
  const { data: store } = useStore();
  const copy = store?.home?.footer;
  const ig = instagramHandle(store?.contact.instagram);
  const email = store?.contact.email;
  const phone = store?.contact.phone;

  return (
    <footer className="foot" inert={inert}>
      <div className="shell">
        <div className="foot-cols">
          <div className="foot-col">
            <div className="label">{store?.name ?? ''}</div>
            <p className="lede" style={{ color: 'var(--bone-70)', fontSize: 15, maxWidth: '34ch' }}>
              {copy?.blurb ?? ''}
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

          <div className="foot-col">
            <div className="label">Client care</div>
            {email && (
              <a className="link-u" href={`mailto:${email}`} style={LINK} data-cursor="Email">
                {email}
              </a>
            )}
            {phone && (
              <a className="link-u" href={`tel:${phone.replace(/[^+\d]/g, '')}`} style={LINK} data-cursor="Call">
                {phone}
              </a>
            )}
            {(store?.policies ?? []).map((p) => (
              <Link className="link-u" key={p.handle} to={`/pages/${p.handle}`} style={LINK}>{p.title}</Link>
            ))}
            {copy?.careNote && (
              <span className="label muted" style={{ color: 'var(--bone-40)', lineHeight: 1.8 }}>{copy.careNote}</span>
            )}
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
          <span>Épicée. Libre.</span>
        </div>
      </div>
    </footer>
  );
}
