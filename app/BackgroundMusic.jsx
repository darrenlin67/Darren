"use client";

import { useState } from "react";

const VIDEO_ID = "LFASWuckB1c";

export default function BackgroundMusic() {
  const [playing, setPlaying] = useState(true);

  return (
    <aside className="music-widget" aria-label="Background music">
      <button
        className="music-toggle"
        type="button"
        aria-expanded={playing}
        aria-controls="background-music-player"
        onClick={() => setPlaying((current) => !current)}
      >
        <span className="music-icon" aria-hidden="true">{playing ? "♪" : "▶"}</span>
        <span>{playing ? "Music is on · unmute in player" : "Play background music"}</span>
      </button>
      {playing && (
        <iframe
          id="background-music-player"
          className="music-player"
          src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?autoplay=1&mute=1&controls=1&start=0&playsinline=1&rel=0`}
          title="YouTube music player"
          allow="autoplay; encrypted-media; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      )}
    </aside>
  );
}
