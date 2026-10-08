"use client";

import { useEffect } from "react";

function randomRoute(width, height, ballWidth, ballHeight) {
  const radiusX = ballWidth / 2;
  const radiusY = ballHeight / 2;
  const rangeX = Math.max(0, width - ballWidth);
  const rangeY = Math.max(0, height - ballHeight);
  const point = (x, y) => ({ x: radiusX + x * rangeX, y: radiusY + y * rangeY });
  const start = point(0.2, 0.22);
  const points = [start];

  for (let index = 0; index < 5; index += 1) {
    points.push(point(0.08 + Math.random() * 0.84, 0.08 + Math.random() * 0.84));
  }

  points.push(start);

  let path = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)];
    const current = points[index];
    const next = points[index + 1];
    const after = points[Math.min(points.length - 1, index + 2)];
    const controlOne = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    };
    const controlTwo = {
      x: next.x - (after.x - current.x) / 6,
      y: next.y - (after.y - current.y) / 6,
    };
    path += ` C ${controlOne.x.toFixed(1)} ${controlOne.y.toFixed(1)}, ${controlTwo.x.toFixed(1)} ${controlTwo.y.toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
  }

  return `path("${path}")`;
}

export default function BasketballMotion() {
  useEffect(() => {
    const ball = document.querySelector(".hero-art .ball");
    const artwork = ball?.closest(".hero-art");
    if (!ball || !artwork) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) return;

    const updatePath = () => {
      const artworkRect = artwork.getBoundingClientRect();
      const ballRect = ball.getBoundingClientRect();
      ball.style.offsetPath = randomRoute(artworkRect.width, artworkRect.height, ballRect.width, ballRect.height);
    };

    updatePath();
    ball.addEventListener("animationiteration", updatePath);
    const resizeObserver = new ResizeObserver(updatePath);
    resizeObserver.observe(artwork);

    return () => {
      ball.removeEventListener("animationiteration", updatePath);
      resizeObserver.disconnect();
      ball.style.removeProperty("offset-path");
    };
  }, []);

  return null;
}
