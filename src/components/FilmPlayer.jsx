import React, { useEffect, useMemo, useRef } from 'react';
import { Player } from '@remotion/player';
import { HeroFilm, FILM } from '../remotion/HeroFilm';
import { OPENING } from '../data/assets';

/** The lightest cut that still holds up on this screen. */
const pickCut = () => {
  if (typeof window === 'undefined') return OPENING[1080];
  if (navigator.connection?.saveData) return OPENING[480];
  return window.innerWidth < 768 ? OPENING[720] : OPENING[1080];
};

/**
 * Split out on its own so the Remotion runtime is fetched after first
 * paint — the hero shows a poster frame immediately and the film
 * fades in over it.
 *
 * The film runs once: it starts when `play` first turns true (the
 * curtain is up), never restarts, and rests on its last frame.
 * `onCue` fires once when it reaches FILM.cue.
 */
export default function FilmPlayer({ playerRef, fmt, play, onCue, video }) {
  // the owner's own film, uploaded in the admin, or the built-in campaign cut
  const inputProps = useMemo(() => ({ video: video || pickCut() }), [video]);
  const started = useRef(false);

  useEffect(() => {
    const p = playerRef.current;
    if (!p || !play || started.current) return;
    started.current = true;
    p.play();
  }, [play, playerRef]);

  useEffect(() => {
    const p = playerRef.current;
    if (!p || !onCue) return;
    let fired = false;
    const cue = () => {
      if (fired) return;
      fired = true;
      onCue();
    };
    const onFrame = ({ detail }) => { if (detail.frame >= FILM.cue) cue(); };
    p.addEventListener('frameupdate', onFrame);
    p.addEventListener('ended', cue);
    return () => {
      p.removeEventListener('frameupdate', onFrame);
      p.removeEventListener('ended', cue);
    };
  }, [onCue, playerRef]);

  return (
    <Player
      ref={playerRef}
      component={HeroFilm}
      inputProps={inputProps}
      durationInFrames={FILM.duration}
      fps={FILM.fps}
      compositionWidth={fmt.w}
      compositionHeight={fmt.h}
      style={{ width: '100%', height: '100%' }}
      controls={false}
      // rest on the last frame (the name over the desert), not back on black
      moveToBeginningWhenEnded={false}
      clickToPlay={false}
      doubleClickToFullscreen={false}
      spaceKeyToPlayOrPause={false}
      initiallyMuted
      // the film is silent: no pooled audio tags, which would otherwise be
      // primed with data: URIs that the CSP (media-src 'self' blob:) refuses
      numberOfSharedAudioTags={0}
    />
  );
}
