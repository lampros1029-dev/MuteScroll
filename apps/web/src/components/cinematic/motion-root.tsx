"use client";

import { useLayoutEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Lenis from "lenis";
import "lenis/dist/lenis.css";

import { prefersReducedMotion } from "./reduced-motion";

gsap.registerPlugin(ScrollTrigger);

/**
 * One Lenis instance for the whole site, driven by the GSAP ticker so
 * ScrollTrigger stays in step. Destroyed on cleanup. Not created when the
 * visitor prefers reduced motion — scroll stays native.
 *
 * Skill: cinematic-gsap-lenis-motion-system.
 * No Three.js. The transcript sheet is the hero object.
 */
export function MotionRoot() {
  useLayoutEffect(() => {
    if (prefersReducedMotion()) return;

    const lenis = new Lenis({
      lerp: 0.08,
      smoothWheel: true,
      wheelMultiplier: 0.9,
      anchors: true,
      autoRaf: false,
      syncTouch: false,
    });

    const unsubscribe = lenis.on("scroll", () => {
      ScrollTrigger.update();
    });

    const onTick = (time: number) => {
      lenis.raf(time * 1000);
    };
    gsap.ticker.add(onTick);
    gsap.ticker.lagSmoothing(0);

    const refresh = () => {
      ScrollTrigger.refresh();
    };
    window.addEventListener("load", refresh);
    let alive = true;
    void document.fonts.ready.then(() => {
      if (alive) refresh();
    });

    return () => {
      alive = false;
      window.removeEventListener("load", refresh);
      unsubscribe();
      gsap.ticker.remove(onTick);
      gsap.ticker.lagSmoothing(500, 33);
      lenis.destroy();
    };
  }, []);

  return null;
}
