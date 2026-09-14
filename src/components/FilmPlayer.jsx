import React from 'react';
import { Player } from '@remotion/player';
import { HeroFilm, FILM } from '../remotion/HeroFilm';

/**
 * Split out on its own so the Remotion runtime is fetched after first
 * paint — the hero shows a poster frame immediately and the film
 * fades in over it.
 */
export default function FilmPlayer({ playerRef, fmt }) {
  return (
    <Player
      ref={playerRef}
      component={HeroFilm}
      durationInFrames={FILM.duration}
      fps={FILM.fps}
      compositionWidth={fmt.w}
      compositionHeight={fmt.h}
      style={{ width: '100%', height: '100%' }}
      autoPlay
      loop
      controls={false}
      clickToPlay={false}
      doubleClickToFullscreen={false}
      spaceKeyToPlayOrPause={false}
      initiallyMuted
    />
  );
}
