import React from 'react';
import { useStore } from '../lib/queries';

/** Until the store answers, the ribbon runs empty rather than on words the owner may have changed. */
export default function Marquee() {
  const words = useStore().data?.home?.ribbon ?? [];
  if (words.length === 0) return null;
  const run = [...words, ...words];
  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee-track">
        {[0, 1].map((k) => (
          <div key={k} style={{ display: 'inline-flex' }}>
            {run.map((w, i) => (
              <span key={`${k}-${i}`}>
                {w} <em>✦</em>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
