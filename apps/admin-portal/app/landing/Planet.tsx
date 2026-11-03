"use client";
import { useEffect, useRef } from "react";

export default function Planet() {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current!;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let generation = 0;
    let stop = () => {};
    function start() {
      const current = ++generation;
      stop();
      element.classList.remove("ready");
      import("./planet-scene")
        .then(({ createPlanet }) => {
          if (current !== generation) return;
          stop = createPlanet(element, media.matches, () =>
            element.classList.add("ready"),
          );
        })
        .catch(() => {
          /* The CSS planet remains visible when WebGL cannot start. */
        });
    }
    start();
    media.addEventListener("change", start);
    return () => {
      generation++;
      media.removeEventListener("change", start);
      stop();
    };
  }, []);
  return (
    <>
      <div className="planet-fallback" aria-hidden="true" />
      <canvas ref={canvas} className="planet-canvas" aria-hidden="true" />
    </>
  );
}
