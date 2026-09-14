import React from 'react';

const WORDS = ['Épicée', 'Libre', 'Échappée 4 à 7', 'Made in Lebanon', 'Limited quantities', 'Prêt-à-porter'];

export default function Marquee() {
  const run = [...WORDS, ...WORDS];
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
