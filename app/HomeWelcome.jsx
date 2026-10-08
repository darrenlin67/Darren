"use client";

import { useState } from "react";

const confettiColors = ["#ff8324", "#ffd166", "#f5f2ed", "#ffad62", "#f07167"];

export default function HomeWelcome() {
  const [celebrating, setCelebrating] = useState(false);
  const [pieces, setPieces] = useState([]);

  function sayYes() {
    setCelebrating(true);
    setPieces(
      Array.from({ length: 64 }, (_, index) => {
        const side = index % 2 === 0 ? "left" : "right";
        const row = Math.floor(index / 2);
        return {
          id: `${Date.now()}-${index}`,
          side,
          color: confettiColors[index % confettiColors.length],
          top: `${8 + ((row * 37) % 84)}%`,
          delay: `${(row % 8) * 35}ms`,
          drift: `${((row * 29) % 140) - 70}px`,
          spin: `${360 + ((row * 113) % 720)}deg`,
          size: `${7 + (row % 5) * 2}px`,
        };
      }),
    );
    window.setTimeout(() => setPieces([]), 2300);
  }

  return (
    <>
      {!celebrating && (
        <div className="welcome-backdrop">
          <section
            className="welcome-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-title"
          >
            <span className="welcome-spark" aria-hidden="true">✦</span>
            <p className="welcome-eyebrow">A very important question</p>
            <h2 id="welcome-title">Do you like Darren?</h2>
            <p className="welcome-subtitle">There’s only one right answer. (It’s both.)</p>
            <div className="welcome-actions">
              <button type="button" onClick={sayYes}>Yes!</button>
              <button type="button" onClick={sayYes}>Yes, obviously!</button>
            </div>
          </section>
        </div>
      )}
      {celebrating && (
        <div className="celebration-message" role="status" aria-live="polite">
          <span aria-hidden="true">🎉</span> Knew it! You’re the best.
        </div>
      )}
      <div className="confetti-layer" aria-hidden="true">
        {pieces.map((piece) => (
          <i
            key={piece.id}
            className={`confetti-piece confetti-${piece.side}`}
            style={{
              "--piece-color": piece.color,
              "--piece-top": piece.top,
              "--piece-delay": piece.delay,
              "--piece-drift": piece.drift,
              "--piece-spin": piece.spin,
              "--piece-size": piece.size,
            }}
          />
        ))}
      </div>
    </>
  );
}
