import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, Easing } from 'remotion';

export const INK = '#0c0b0a';
export const BONE = '#f2ede6';

export const SERIF = "'Instrument Serif', 'Times New Roman', serif";

/**
 * Reveal masks clip on every side, which eats accents (É) and
 * descenders at the tight line-heights this type wants. Pad the mask
 * out and pull it back with equal negative margin: more room to clip
 * against, identical layout.
 */
const MASK = {
  paddingTop: '0.2em',
  marginTop: '-0.2em',
  paddingBottom: '0.24em',
  marginBottom: '-0.24em',
};

/** Text that rises out of a mask, each glyph on its own delay. */
export const RiseChars = ({ text, delay = 0, stagger = 2.4, duration = 30, style }) => {
  const frame = useCurrentFrame();
  return (
    <span style={{ display: 'flex', overflow: 'hidden', ...MASK, ...style }}>
      {text.split('').map((ch, i) => {
        const y = interpolate(frame - delay - i * stagger, [0, duration], [115, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
          easing: Easing.bezier(0.19, 1, 0.22, 1),
        });
        return (
          <span key={i} style={{ display: 'block', transform: `translateY(${y}%)`, whiteSpace: 'pre' }}>
            {ch}
          </span>
        );
      })}
    </span>
  );
};

/** Per-frame film grain — offset by frame so it never syncs with CSS. */
export const Grain = ({ opacity = 0.3 }) => {
  const frame = useCurrentFrame();
  const x = (frame * 37) % 180;
  const y = (frame * 61) % 180;
  return (
    <AbsoluteFill
      style={{
        pointerEvents: 'none',
        opacity,
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)' opacity='0.5'/%3E%3C/svg%3E\")",
        backgroundPosition: `${x}px ${y}px`,
      }}
    />
  );
};
