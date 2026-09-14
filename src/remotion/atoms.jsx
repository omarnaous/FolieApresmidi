import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig, Easing } from 'remotion';

export const INK = '#0c0b0a';
export const BONE = '#f2ede6';
export const CHILI = '#d7301c';
export const TERRA = '#c4522c';

export const SERIF = "'Instrument Serif', 'Times New Roman', serif";
export const SANS = "'Inter', -apple-system, sans-serif";

/** Uppercase tracked micro-label — the "slate" voice of the film. */
export const Label = ({ children, size = 1, color = BONE, style }) => {
  const { width } = useVideoConfig();
  return (
    <div
      style={{
        fontFamily: SANS,
        fontSize: width * 0.0085 * size,
        letterSpacing: '0.26em',
        textTransform: 'uppercase',
        fontWeight: 500,
        color,
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/**
 * A photographic plate with a slow Ken Burns move and the house grade.
 * `dir` flips the drift so consecutive shots never move the same way.
 */
export const Plate = ({
  src,
  from = 1.16,
  to = 1.0,
  dir = 1,
  duration = 180,
  drift = 0.035,
  focus = '50% 40%',
  dim = 0.18,
}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, duration], [from, to], {
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.25, 0.1, 0.25, 1),
  });
  const x = interpolate(frame, [0, duration], [drift * 100 * dir, -drift * 40 * dir], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: '#1a1613' }}>
      <Img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          objectPosition: focus,
          transform: `scale(${scale}) translateX(${x}px)`,
          filter: 'saturate(0.74) contrast(1.08)',
        }}
      />
      <AbsoluteFill
        style={{
          background: `linear-gradient(180deg, rgba(196,82,44,0.10), rgba(12,11,10,0.30))`,
          mixBlendMode: 'multiply',
        }}
      />
      <AbsoluteFill style={{ backgroundColor: INK, opacity: dim }} />
    </AbsoluteFill>
  );
};

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

/** Text that rises out of a mask, one line at a time. */
export const Rise = ({ children, delay = 0, duration = 26, style, ease = Easing.bezier(0.19, 1, 0.22, 1) }) => {
  const frame = useCurrentFrame();
  const y = interpolate(frame - delay, [0, duration], [110, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: ease,
  });
  return (
    <div style={{ overflow: 'hidden', ...MASK }}>
      <div style={{ transform: `translateY(${y}%)`, ...style }}>{children}</div>
    </div>
  );
};

/** Same, but each glyph carries its own delay. */
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

/** Colour panel that sweeps across frame — the cut between acts. */
export const Wipe = ({ start, color = CHILI, side = 'left', enter = 16, exit = 16, hold = 4 }) => {
  const frame = useCurrentFrame();
  const t = frame - start;
  const horiz = side === 'left' || side === 'right';
  const cover = interpolate(t, [0, enter], [100, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.7, 0, 0.3, 1) });
  const clear = interpolate(t, [enter + hold, enter + hold + exit], [0, 100], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.7, 0, 0.3, 1) });

  const edges = horiz
    ? { inset: `0 ${side === 'left' ? cover : clear}% 0 ${side === 'left' ? clear : cover}%` }
    : { inset: `${side === 'top' ? clear : cover}% 0 ${side === 'top' ? cover : clear}% 0` };

  if (t < 0 || t > enter + hold + exit) return null;
  return <AbsoluteFill style={{ backgroundColor: color, clipPath: `inset(${edges.inset})` }} />;
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

/** Registration crosshair, borrowed from a camera slate. */
export const Cross = ({ size = 28, color = BONE, weight = 1, style }) => (
  <svg width={size} height={size} viewBox="0 0 28 28" style={style} fill="none">
    <path d="M14 0v28M0 14h28" stroke={color} strokeWidth={weight} opacity="0.8" />
    <circle cx="14" cy="14" r="7" stroke={color} strokeWidth={weight} opacity="0.55" />
  </svg>
);

export const tc = (frame, fps) => {
  const total = Math.floor(frame / fps);
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  const ff = String(Math.floor(frame % fps)).padStart(2, '0');
  return `${mm}:${ss}:${ff}`;
};

/**
 * Safe area for type inside the film. The site's own hero chrome
 * (nav, scroll cue, film control) sits over the top and bottom
 * edges, so titles stay clear of both.
 */
export const useSafe = () => {
  const { width, height } = useVideoConfig();
  const portrait = height > width;
  return {
    x: width * 0.05,
    top: height * 0.11,
    bottom: height * 0.14,
    portrait,
    width,
    height,
  };
};
