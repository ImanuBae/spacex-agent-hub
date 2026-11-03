"use client";
import { useEffect } from "react";
import Lenis from "lenis";

export default function Motion() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".ascend");
    if (!root) return;
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let stop = () => {};
    function start() {
      stop();
      if (media.matches) {
        root!.classList.remove("motion-ready");
        return;
      }
      const observer = new IntersectionObserver(
        (entries) =>
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add("in");
              observer.unobserve(entry.target);
            }
          }),
        { threshold: 0.18, rootMargin: "0px 0px -8% 0px" },
      );
      root!.classList.add("motion-ready");
      root!
        .querySelectorAll("[data-reveal]")
        .forEach((el) => observer.observe(el));
      const lenis = new Lenis({
        duration: 1.15,
        smoothWheel: true,
        touchMultiplier: 1.5,
        anchors: true,
        virtualScroll: () => {
          // Preserve native scrollbar/keyboard jumps before smoothing the next wheel event.
          if (Math.abs(lenis.actualScroll - lenis.animatedScroll) > 2)
            lenis.scrollTo(lenis.actualScroll, { immediate: true });
          return true;
        },
      });
      let frame = 0;
      const tick = (time: number) => {
        lenis.raf(time);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
      stop = () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        lenis.destroy();
        root!.classList.remove("motion-ready");
      };
    }
    start();
    media.addEventListener("change", start);
    return () => {
      media.removeEventListener("change", start);
      stop();
    };
  }, []);
  return null;
}
