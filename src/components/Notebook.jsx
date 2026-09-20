import React, { useEffect, useRef, useState } from 'react';

/**
 * The notebook the house hands out — the owner's PDF, uploaded in the admin.
 *
 * A plain link would hand the file to the browser and say nothing for the
 * seconds it takes. This fetches it instead, so the ring around the button
 * fills as the bytes arrive, then saves it and rests on "Saved". A browser
 * that cannot read the progress still fills the ring slowly, and anything
 * that refuses the fetch falls back to opening the file.
 */
export default function Notebook({ file }) {
  const [state, setState] = useState('idle'); // idle · loading · done
  const [pct, setPct] = useState(0);
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const name = /\.pdf$/i.test(file.alt || '') ? file.alt : `${(file.alt || 'notebook').replace(/\.[a-z0-9]+$/i, '')}.pdf`;

  const save = async (e) => {
    e.preventDefault();
    if (state === 'loading') return;
    setState('loading');
    setPct(0);
    try {
      const res = await fetch(file.url);
      if (!res.ok) throw new Error(String(res.status));
      const total = Number(res.headers.get('content-length')) || 0;
      const reader = res.body?.getReader();

      let blob;
      if (reader) {
        const chunks = [];
        let read = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          read += value.length;
          // no length header (a compressed response): creep towards the end instead
          setPct(total ? Math.min(99, Math.round((read / total) * 100)) : (p) => Math.min(95, p + 7));
        }
        blob = new Blob(chunks, { type: 'application/pdf' });
      } else {
        blob = await res.blob();
      }

      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = name;
      a.click();
      timers.current.push(setTimeout(() => URL.revokeObjectURL(href), 10_000));
      setPct(100);
      setState('done');
      timers.current.push(setTimeout(() => setState('idle'), 4000));
    } catch {
      // the fetch was refused: let the browser have the file the ordinary way
      window.open(file.url, '_blank', 'noopener');
      setState('idle');
    }
  };

  return (
    <a
      className={`btn book book--${state}`}
      href={file.url}
      download={name}
      onClick={save}
      aria-busy={state === 'loading'}
      data-cursor={state === 'done' ? 'Saved' : 'Download'}
      style={{ '--pct': pct }}
    >
      <span className="book-ring" aria-hidden="true" />
      <span className="book-label">
        {state === 'done' ? 'Saved ✓' : state === 'loading' ? `Downloading ${pct}%` : 'The notebook'}
      </span>
      <svg className="book-arrow" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
        <path d="M12 4v13M6 12l6 6 6-6" />
      </svg>
    </a>
  );
}
