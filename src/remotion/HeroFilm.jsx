import React from 'react';
import {
  AbsoluteFill, Sequence, Img,
  useCurrentFrame, useVideoConfig, interpolate, Easing,
} from 'remotion';
import { HERO_FRAME, SHEET, PAPER, FINALE } from '../data/assets';
import {
  Rise, RiseChars, Wipe, Grain, Label, Cross, tc, useSafe,
  INK, BONE, CHILI, SERIF, SANS,
} from './atoms';

/* ── Score ──────────────────────────────────────────────────
   Every picture in the film comes from @folliesdapresmidi. Frames are
   presented as plates rather than run full-bleed, because the feed
   serves 640px — at 30–45% of the frame they land near 1:1. Only the
   finale goes full-bleed, under enough ink that the softness reads as
   grain. It ends on black, so the loop seam is invisible.        */

export const FILM = { fps: 30, duration: 760 };

const ACTS = {
  leader:   { from: 0,   len: 78 },
  epicee:   { from: 70,  len: 190 },
  libre:    { from: 250, len: 190 },
  paper:    { from: 430, len: 145 },
  wordmark: { from: 565, len: 195 },
};

/** A campaign frame in a plate — the film's basic unit of image. */
const Frame = ({ item, width, height, delay = 0, dur = 180, from = 1.1, to = 1.0, label = true, labelColor = 'rgba(242,237,230,0.5)' }) => {
  const frame = useCurrentFrame();
  const t = frame - delay;
  const reveal = interpolate(t, [0, 26], [100, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.76, 0, 0.24, 1),
  });
  const scale = interpolate(t, [0, dur], [from, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.25, 0.1, 0.25, 1),
  });

  return (
    <div style={{ width, height, position: 'relative' }}>
      <div style={{ width: '100%', height: '100%', overflow: 'hidden', clipPath: `inset(${reveal}% 0 0 0)` }}>
        <Img
          src={item.src}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${scale})`,
            filter: 'saturate(0.86) contrast(1.06)',
          }}
        />
      </div>
      {label && (
        <div style={{ position: 'absolute', left: 0, top: '100%', paddingTop: '0.7em', opacity: interpolate(t, [22, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
          <Label style={{ color: labelColor, fontSize: Math.max(9, width * 0.045) }}>
            {item.date}
          </Label>
        </div>
      )}
    </div>
  );
};

/* ── Act I — Academy leader ─────────────────────────────── */

const Leader = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const safe = useSafe();
  const count = 3 - Math.floor(frame / 26);
  const beat = frame % 26;
  const sweep = interpolate(beat, [0, 26], [0, 360]);
  const pop = interpolate(beat, [0, 6], [1.08, 1], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) });
  const flash = interpolate(frame, [70, 74, 78], [0, 0.85, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const pad = width * 0.035;
  const dial = Math.min(width, height) * 0.36;

  return (
    <AbsoluteFill style={{ color: BONE }}>
      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div
          style={{
            width: dial, height: dial, borderRadius: '50%',
            background: `conic-gradient(from ${sweep}deg, rgba(242,237,230,0.14) 0deg, rgba(242,237,230,0.01) 90deg, transparent 180deg)`,
            border: '1px solid rgba(242,237,230,0.16)',
            display: 'grid', placeItems: 'center',
          }}
        >
          <div
            style={{
              fontFamily: SERIF,
              fontSize: dial * 0.52,
              lineHeight: 1,
              transform: `scale(${pop})`,
              opacity: interpolate(beat, [0, 3, 22, 26], [0, 1, 1, 0.2]),
            }}
          >
            {count > 0 ? count : ''}
          </div>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ padding: `${safe.top * 0.6}px ${safe.x}px ${safe.bottom * 0.7}px`, justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <Label>Échappée 4 à 7 — Reel 01</Label>
          <Label style={{ color: CHILI }}>● REC</Label>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <Label>Beirut — 33.8938° N</Label>
          <Label style={{ fontFamily: SANS, letterSpacing: '0.14em' }}>{tc(frame, fps)}</Label>
        </div>
      </AbsoluteFill>

      <Cross size={width * 0.022} style={{ position: 'absolute', top: pad * 2.2, left: pad * 2.2 }} />
      <Cross size={width * 0.022} style={{ position: 'absolute', bottom: pad * 2.2, right: pad * 2.2 }} />
      <AbsoluteFill style={{ backgroundColor: BONE, opacity: flash }} />
    </AbsoluteFill>
  );
};

/* ── Act II — ÉPICÉE ────────────────────────────────────── */

const Epicee = () => {
  const { width, height } = useVideoConfig();
  const safe = useSafe();
  const frame = useCurrentFrame();
  const rule = interpolate(frame, [48, 88], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.19, 1, 0.22, 1),
  });

  // the plate is sized off the frame so the 640px source lands near 1:1
  const plateH = safe.portrait ? height * 0.42 : height * 0.66;
  const plateW = plateH * (HERO_FRAME.w / HERO_FRAME.h);

  return (
    <AbsoluteFill style={{ backgroundColor: INK, color: BONE }}>
      <AbsoluteFill
        style={{
          padding: `${safe.top}px ${safe.x}px ${safe.bottom}px`,
          display: 'flex',
          flexDirection: safe.portrait ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: safe.x,
        }}
      >
        {safe.portrait && <Frame item={HERO_FRAME} width={plateW} height={plateH} delay={10} />}

        <div style={{ flex: safe.portrait ? 'none' : 1 }}>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: width * (safe.portrait ? 0.2 : 0.155),
              lineHeight: 0.82,
              letterSpacing: '-0.025em',
            }}
          >
            <RiseChars text="ÉPICÉE." delay={26} stagger={3} />
          </div>
          <div style={{ height: height * 0.024 }} />
          <div style={{ height: 2, background: CHILI, transform: `scaleX(${rule})`, transformOrigin: 'left' }} />
          <div style={{ height: height * 0.024 }} />
          <Rise delay={58}>
            <Label style={{ color: 'rgba(242,237,230,0.7)' }}>Spiced — never sweet</Label>
          </Rise>
        </div>

        {!safe.portrait && <Frame item={HERO_FRAME} width={plateW} height={plateH} delay={10} />}
      </AbsoluteFill>

      <div style={{ position: 'absolute', top: safe.top * 0.55, left: safe.x }}>
        <Rise delay={16}><Label style={{ color: 'rgba(242,237,230,0.45)' }}>Chapitre 01</Label></Rise>
      </div>
    </AbsoluteFill>
  );
};

/* ── Act III — LIBRE, as a contact sheet ────────────────── */

const Libre = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const safe = useSafe();

  const cols = safe.portrait ? 2 : 5;
  const rows = safe.portrait ? 2 : 1;
  const shown = SHEET.slice(0, cols * rows);
  const gap = Math.min(width, height) * 0.022;

  const cellW = (width - safe.x * 2 - gap * (cols - 1)) / cols;
  const cellH = cellW * 1.25;

  return (
    <AbsoluteFill style={{ backgroundColor: INK, color: BONE }}>
      <AbsoluteFill
        style={{
          padding: `${safe.top}px ${safe.x}px ${safe.bottom}px`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: safe.x }}>
          <Rise delay={14}>
            <Label style={{ color: 'rgba(242,237,230,0.45)' }}>Chapitre 02 — La planche-contact</Label>
          </Rise>
          <Rise delay={20}>
            <Label style={{ color: 'rgba(242,237,230,0.45)' }}>@folliesdapresmidi</Label>
          </Rise>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, ${cellW}px)`,
            gap,
            justifyContent: 'center',
            alignSelf: 'center',
          }}
        >
          {shown.map((item, i) => (
            <div key={item.code} style={{ transform: `translateY(${i % 2 ? cellH * 0.07 : -cellH * 0.04}px)` }}>
              <Frame item={item} width={cellW} height={cellH} delay={10 + i * 6} dur={190} from={1.14} />
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              fontFamily: SERIF,
              fontSize: width * (safe.portrait ? 0.22 : 0.15),
              lineHeight: 0.8,
              letterSpacing: '-0.03em',
              display: 'flex',
              justifyContent: 'flex-end',
            }}
          >
            <RiseChars text="LIBRE." delay={48} stagger={3.4} />
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ── Act IV — printed on paper ──────────────────────────── */

const Paper = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const safe = useSafe();
  const col = !safe.portrait;

  const sheet = interpolate(frame, [0, 24], [100, 0], {
    extrapolateRight: 'clamp', easing: Easing.bezier(0.76, 0, 0.24, 1),
  });
  const band = interpolate(frame, [36, 68], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.19, 1, 0.22, 1),
  });

  const shown = col ? PAPER : PAPER.slice(0, 2);
  const gap = Math.min(width, height) * 0.03;
  const cellW = (width - safe.x * 2 - gap * (shown.length - 1)) / shown.length;
  const cellH = Math.min(cellW * 1.28, height - safe.top - safe.bottom - height * 0.1);

  return (
    <AbsoluteFill style={{ backgroundColor: BONE, clipPath: `inset(${sheet}% 0 0 0)` }}>
      <AbsoluteFill
        style={{
          padding: `${safe.top * 0.8}px ${safe.x}px ${safe.bottom * 0.8}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap,
        }}
      >
        {shown.map((item, i) => (
          <div key={item.code} style={{ transform: `translateY(${i % 2 ? cellH * 0.05 : -cellH * 0.03}px)` }}>
            <Frame
              item={item}
              width={cellW}
              height={cellH}
              delay={10 + i * 8}
              dur={145}
              from={1.12}
              labelColor="rgba(12,11,10,0.45)"
            />
          </div>
        ))}
      </AbsoluteFill>

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div
          style={{
            background: INK, color: BONE,
            padding: `${height * 0.024}px ${width * (col ? 0.045 : 0.06)}px`,
            clipPath: `inset(0 ${(1 - band) * 100}% 0 0)`,
            display: 'flex', alignItems: 'center',
            gap: Math.min(width, height) * 0.04,
          }}
        >
          {col && <Label>La collection</Label>}
          <span style={{ fontFamily: SERIF, fontSize: Math.min(width, height) * (col ? 0.036 : 0.07), lineHeight: 1, whiteSpace: 'nowrap' }}>
            Échappée <i>4 à 7</i>
          </span>
          <Label style={{ color: CHILI }}>En boutique</Label>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ── Act V — Wordmark ───────────────────────────────────── */

const Wordmark = () => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const safe = useSafe();
  const lines = ['FOLLIES', "D'APRÈS", 'MIDI'];

  const rule = interpolate(frame, [86, 126], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.19, 1, 0.22, 1) });
  const sub = interpolate(frame, [104, 130], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  // fade to black so the loop seam lands on the leader unnoticed
  const out = interpolate(frame, [158, 195], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.in(Easing.cubic),
  });
  const push = interpolate(frame, [0, 195], [1.16, 1.02], {
    extrapolateRight: 'clamp', easing: Easing.bezier(0.25, 0.1, 0.25, 1),
  });

  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      {/* the only full-bleed frame in the film — heavy ink over it keeps
          the 640px source reading as grain rather than softness */}
      <AbsoluteFill style={{ overflow: 'hidden' }}>
        <Img
          src={FINALE.src}
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            transform: `scale(${push})`,
            filter: 'saturate(0.84) contrast(1.1)',
          }}
        />
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          background: 'linear-gradient(180deg, rgba(196,82,44,0.10), rgba(12,11,10,0.42))',
          mixBlendMode: 'multiply',
        }}
      />
      <AbsoluteFill style={{ backgroundColor: INK, opacity: 0.58 }} />

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', color: BONE, textAlign: 'center' }}>
        <div>
          {lines.map((l, i) => (
            <div
              key={l}
              style={{
                fontFamily: SERIF,
                fontSize: width * (safe.portrait ? 0.165 : 0.115),
                lineHeight: 0.88, letterSpacing: '-0.02em',
                display: 'flex', justifyContent: 'center',
              }}
            >
              <RiseChars text={l} delay={14 + i * 11} stagger={2.2} duration={34} />
            </div>
          ))}
          <div style={{ height: height * 0.035 }} />
          <div style={{ height: 1, background: 'rgba(242,237,230,0.5)', transform: `scaleX(${rule})` }} />
          <div style={{ height: height * 0.028 }} />
          <div style={{ opacity: sub, display: 'flex', gap: width * 0.035, justifyContent: 'center' }}>
            <Label>Épicée</Label>
            <Label style={{ color: CHILI }}>·</Label>
            <Label>Libre</Label>
          </div>
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ backgroundColor: INK, opacity: out }} />
    </AbsoluteFill>
  );
};

/* ── The film ───────────────────────────────────────────── */

export const HeroFilm = () => {
  const { width } = useVideoConfig();

  return (
    <AbsoluteFill style={{ backgroundColor: INK }}>
      <Sequence from={ACTS.leader.from} durationInFrames={ACTS.leader.len}><Leader /></Sequence>
      <Sequence from={ACTS.epicee.from} durationInFrames={ACTS.epicee.len}><Epicee /></Sequence>
      <Sequence from={ACTS.libre.from} durationInFrames={ACTS.libre.len}><Libre /></Sequence>
      <Sequence from={ACTS.paper.from} durationInFrames={ACTS.paper.len}><Paper /></Sequence>
      <Sequence from={ACTS.wordmark.from} durationInFrames={ACTS.wordmark.len}><Wordmark /></Sequence>

      {/* cuts */}
      <Wipe start={244} color={CHILI} side="left" enter={13} hold={3} exit={13} />
      <Wipe start={556} color={INK} side="right" enter={12} hold={2} exit={12} />

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
