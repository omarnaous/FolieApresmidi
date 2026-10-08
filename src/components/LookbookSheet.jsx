import React, { useRef } from 'react';
import { imageSrc } from '../../shared/api';
import { srcSet } from '../lib/catalog';
import { emphasis } from '../lib/emphasis';
import Reveal from './Reveal';
import { useStore } from '../lib/queries';
import { useEscape, useLinger, useSheetFocus } from '../hooks/useSheet';
import { useLooks } from './Lookbook';

/**
 * The full look book: every photograph, on its own, as a graded grid that
 * uncovers on the scroll with the house's curtain. No piece, no price — the
 * images carry it. Reached from the look book's "View the look book" button;
 * the URL is /lookbook, so it is shareable and Back closes it.
 */
export default function LookbookSheet({ open, onClose }) {
  // keep the grid mounted through the slide-out
  const held = useLinger(open, 820);
  const ref = useRef(null);
  useEscape(open, onClose);
  useSheetFocus(ref, open);

  const { data: store } = useStore();
  const copy = store?.home?.lookbook;
  const looks = useLooks();

  return (
    <section
      className={`lb-sheet ${open ? 'on' : ''}`}
      aria-hidden={!open}
      data-lenis-prevent
      ref={ref}
      tabIndex={-1}
      aria-label="The look book"
    >
      <div className="lb-sheet-bar shell">
        <div>
          <div className="label muted">Look book</div>
          <h2 className="display d-sm" style={{ marginTop: 6 }}>
            {copy?.heading ? emphasis(copy.heading) : 'The lookbook'}
          </h2>
        </div>
        <button className="label link-u" onClick={onClose} data-cursor="Close">Close</button>
      </div>

      <div className="lb-sheet-body shell">
        {held && (
          <div className="lb-grid lb-grid--all">
            {looks.map((m, i) => (
              <Reveal
                key={m.id}
                variant="rv-mask"
                delay={(i % 3) * 110}
                className="rv-img plate lb-plate"
                as="figure"
              >
                <img
                  decoding="async"
                  src={imageSrc(m, 1400)}
                  srcSet={srcSet(m, [640, 960, 1400, 2000])}
                  sizes="(max-width: 560px) 100vw, (max-width: 1040px) 50vw, 33vw"
                  alt={m.alt || `Follies d'Après-Midi — look ${i + 1}`}
                  loading={i < 6 ? 'eager' : 'lazy'}
                  draggable="false"
                />
              </Reveal>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
