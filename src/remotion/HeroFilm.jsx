import React, { useState } from 'react';
import {
  AbsoluteFill, Img, Html5Video,
  useCurrentFrame, useVideoConfig, interpolate, Easing,
} from 'remotion';
import { LOGO, OPENING } from '../data/assets';
import { Grain, INK, BONE } from './atoms';

/* ── Score ──────────────────────────────────────────────────
   One shot: the campaign film from the Shopify store, full-bleed, with
   the name over it.

   The house logo draws itself out of black from the crown of its arch,
   with the film showing only through the letters (white on a black
   matte, multiplied over the picture). The matte is pushed through the
   lens and the landscape opens up bright; then the picture is graded
   down and the logo returns in bone, pulling focus as it opens out of
   the frame, and its rule draws. It plays once. Three seconds after the
   logo is shown the site puts up its scroll cue (FILM.cue); the footage
   runs out underneath and the film rests on its last frame, logo and all.

   The footage is a pale 4:3 desert, so it is anchored to its lower
   edge, where the figure and the tree are, and held under enough ink
   for the type to read.                                        */

const FPS = 30;
const settle = Easing.bezier(0.19, 1, 0.22, 1);

const T = {
  matteIn: 10,              // the matte begins to draw
  through: [58, 98],        // matte pushed through the lens
  dim: [96, 156],           // picture graded down under the type
  focus: [104, 152],        // the name returns in bone
  rule: [150, 192],         // …and its rule draws: the name is shown
};

/** The settle curve looks finished well before it formally ends. */
const settledAt = ([from, to]) => {
  for (let f = from; f <= to; f++) if (settle((f - from) / (to - from)) >= 0.99) return f;
  return to;
};

const HOLD = 3 * FPS;       // the shown name holds this long before the cue
const FOOTAGE = Math.floor(11.5 * FPS);  // the Shopify film is 11.56 s

export const FILM = {
  fps: FPS,
  duration: FOOTAGE,
  /** the frame the site brings in its scroll cue */
  cue: settledAt(T.rule) + HOLD,
};

const clamp = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' };

/** How long the arch takes to draw itself, in frames. */
const DRAW = 46;

/**
 * The house logo, painted through its own alpha so it takes whatever
 * colour it is given — white for the matte, bone for the name itself.
 * `draw` runs 0 → 1 and opens it outward from the crown of the arch.
 */
const Mark = ({ width, colour, draw = 1 }) => {
  const edge = ((1 - draw) * 50).toFixed(2);
  return (
    <div
      style={{
        width,
        aspectRatio: String(LOGO.ratio),
        backgroundColor: colour,
        WebkitMaskImage: `url(${LOGO.lockup})`,
        maskImage: `url(${LOGO.lockup})`,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        clipPath: `inset(0 ${edge}% 0 ${edge}%)`,
      }}
    />
  );
};

/** The logo over its rule, centred a little high so the site's scroll
    cue has the bottom of the frame. Drawn twice with the same box —
    once as the matte, once in bone — so the two register. Nothing sits
    under the rule: that is where the figure is. */
const Lockup = ({ width, colour, draw, rule = 0, style }) => {
  const { height } = useVideoConfig();
  return (
    <AbsoluteFill
      style={{ alignItems: 'center', justifyContent: 'center', paddingBottom: height * 0.08, ...style }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <Mark width={width} colour={colour} draw={draw} />
        <div style={{ height: height * 0.035 }} />
        <div style={{ width, height: 1, background: 'rgba(242,237,230,0.5)', transform: `scaleX(${rule})` }} />
      </div>
    </AbsoluteFill>
  );
};

const Opening = ({ src }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  // a film that cannot play shows its last frame throughout
  const [failed, setFailed] = useState(!src);
  const still = failed || frame >= FILM.duration - 1;

  const markW = Math.min(width * 0.74, height * 1.9);
  const draw = interpolate(frame, [T.matteIn, T.matteIn + DRAW], [0, 1], { ...clamp, easing: settle });

  const push = interpolate(frame, [0, FILM.duration], [1.14, 1], {
    ...clamp, easing: Easing.bezier(0.25, 0.1, 0.25, 1),
  });
  const through = interpolate(frame, T.through, [0, 1], { ...clamp, easing: Easing.in(Easing.cubic) });
  // a bright beat on the open landscape, then down under the type
  const dim = interpolate(frame, T.dim, [0.04, 0.42], { ...clamp, easing: Easing.inOut(Easing.cubic) });
  // focus pull, tracking closing in
  const focus = interpolate(frame, T.focus, [0, 1], { ...clamp, easing: settle });
  const rule = interpolate(frame, T.rule, [0, 1], { ...clamp, easing: settle });

  // video and still are stacked, not flowed
  const picture = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    objectPosition: '64% 100%',
    transform: `scale(${push})`,
    transformOrigin: '60% 85%',
    filter: 'saturate(1.12) contrast(1.08)',
  };

  return (
    <AbsoluteFill style={{ backgroundColor: INK, isolation: 'isolate' }}>
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        {!failed && (
          <Html5Video
            src={src}
            muted
            pauseWhenBuffering
            onError={() => setFailed(true)}
            style={picture}
          />
        )}
        {/* mounted from the cue on so it has loaded by the last frame */}
        {(failed || frame >= FILM.cue) && (
          <Img src={OPENING.end} onError={() => {}} style={{ ...picture, opacity: still ? 1 : 0 }} />
        )}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: 'linear-gradient(180deg, rgba(196,82,44,0.24), rgba(12,11,10,0.38))',
          mixBlendMode: 'multiply',
        }}
      />
      <AbsoluteFill style={{ backgroundColor: INK, opacity: dim }} />

      {through < 1 && (
        <Lockup
          width={markW}
          colour="#fff"
          draw={draw}
          style={{
            backgroundColor: '#000',
            color: '#fff',
            mixBlendMode: 'multiply',
            opacity: 1 - through,
            transform: `scale(${1 + through * 2.6})`,
          }}
        />
      )}

      {focus > 0 && (
        <Lockup
          width={markW}
          colour={BONE}
          rule={rule}
          style={{
            opacity: focus,
            filter: focus < 1 ? `blur(${(1 - focus) * 14}px)` : undefined,
            // it opens out of the frame as it lands
            transform: `scale(${1.18 - focus * 0.18})`,
          }}
        />
      )}
    </AbsoluteFill>
  );
};

/* ── The film ───────────────────────────────────────────── */

export const HeroFilm = ({ video }) => {
  const { width } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <Opening src={video} />

      <Grain opacity={0.26} />
      <AbsoluteFill
        style={{
          pointerEvents: 'none',
          background: 'radial-gradient(120% 85% at 50% 42%, transparent 45%, rgba(12,11,10,0.42) 100%)',
        }}
      />
      <div style={{ position: 'absolute', left: width * 0.02, top: '50%', width: width * 0.012, height: 1, background: 'rgba(242,237,230,0.25)' }} />
      <div style={{ position: 'absolute', right: width * 0.02, top: '50%', width: width * 0.012, height: 1, background: 'rgba(242,237,230,0.25)' }} />
    </AbsoluteFill>
  );
};
