"use client";

import { useLayoutEffect } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

import { prefersReducedMotion } from "./reduced-motion";
import { splitWords } from "./split-words";

gsap.registerPlugin(ScrollTrigger);

const REVEAL = { duration: 0.95, ease: "power4.out" } as const;

/**
 * Home-page choreography only. Lenis itself lives in MotionRoot.
 * Reduced motion skips scrubbed timelines and leaves the server-rendered
 * page in its final state.
 */
export function HomeMotion() {
  useLayoutEffect(() => {
    const reduce = prefersReducedMotion();
    document.documentElement.dataset.motionLive = "true";

    if (reduce) {
      document.documentElement.classList.remove("has-motion");
      return () => {
        delete document.documentElement.dataset.motionLive;
      };
    }

    document.documentElement.classList.add("has-motion");
    const cleanups: Array<() => void> = [];

    const ctx = gsap.context(() => {
      try {
        initHero();
        initScrollWords();
        initChapters();
        initReveals();
        cleanups.push(initPointer());
      } catch {
        document.documentElement.classList.remove("has-motion");
        gsap.set("[data-motion-text], .caption-sheet .segment, [data-reveal], [data-reveal-item]", {
          clearProps: "all",
        });
      }
    });

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
      for (const cleanup of cleanups) cleanup();
      ctx.revert();
      delete document.documentElement.dataset.motionLive;
    };
  }, []);

  return null;
}

function initHero(): void {
  const stage = document.querySelector(".cinema-stage");
  if (stage === null) return;

  const words = Array.from(stage.querySelectorAll<HTMLElement>('[data-motion-text="words"]')).flatMap((element) =>
    splitWords(element),
  );
  const segments = Array.from(stage.querySelectorAll<HTMLElement>(".caption-sheet .segment"));

  const timeline = gsap.timeline({ defaults: { ease: "power4.out" } });
  if (words.length > 0) {
    timeline.fromTo(words, { yPercent: 112 }, { yPercent: 0, duration: 0.95, stagger: 0.055 }, 0);
  }
  if (segments.length > 0) {
    timeline.fromTo(
      segments,
      { y: 18, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.85, stagger: 0.12 },
      0.32,
    );
  }
}

function initScrollWords(): void {
  const headings = Array.from(document.querySelectorAll<HTMLElement>('[data-motion-text="words"]')).filter(
    (element) => element.closest(".cinema-stage") === null,
  );

  for (const heading of headings) {
    const words = splitWords(heading);
    if (words.length === 0) continue;
    gsap.fromTo(
      words,
      { yPercent: 112 },
      {
        yPercent: 0,
        duration: 0.9,
        ease: "power4.out",
        stagger: 0.045,
        scrollTrigger: {
          trigger: heading,
          start: "top 82%",
          once: true,
        },
      },
    );
  }
}

function initChapters(): void {
  const scene = document.querySelector<HTMLElement>("[data-chapter-scene]");
  const bar = document.querySelector<HTMLElement>("[data-chapter-progress]");
  if (scene === null || bar === null) return;

  gsap.fromTo(
    bar,
    { scaleY: 0 },
    {
      scaleY: 1,
      ease: "none",
      transformOrigin: "top center",
      scrollTrigger: {
        trigger: scene,
        start: "top 70%",
        end: "bottom 60%",
        scrub: 1.1,
        invalidateOnRefresh: true,
      },
    },
  );
}

function initReveals(): void {
  const groups = gsap.utils.toArray<HTMLElement>("[data-reveal-group]");
  for (const group of groups) {
    const items = group.querySelectorAll<HTMLElement>("[data-reveal-item]");
    if (items.length === 0) continue;
    gsap.fromTo(
      items,
      { y: 32, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        ...REVEAL,
        stagger: 0.08,
        scrollTrigger: {
          trigger: group,
          start: "top 82%",
          once: true,
        },
      },
    );
  }

  const singles = gsap.utils.toArray<HTMLElement>("[data-reveal]");
  for (const element of singles) {
    if (element.hasAttribute("data-reveal-item")) continue;
    if (element.closest("[data-reveal-group]") !== null) continue;
    gsap.fromTo(element, { y: 28, opacity: 0 }, {
      y: 0,
      opacity: 1,
      ...REVEAL,
      scrollTrigger: {
        trigger: element,
        start: "top 84%",
        once: true,
      },
    });
  }
}

function initPointer(): () => void {
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (!finePointer) return () => undefined;

  const cleanups: Array<() => void> = [];

  for (const element of document.querySelectorAll<HTMLElement>("[data-magnetic]")) {
    if (element.closest("form") !== null) continue;
    const xTo = gsap.quickTo(element, "x", { duration: 0.45, ease: "power3.out" });
    const yTo = gsap.quickTo(element, "y", { duration: 0.45, ease: "power3.out" });
    const reset = () => {
      xTo(0);
      yTo(0);
    };
    const onMove = (event: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      const strength = 0.16;
      xTo((event.clientX - rect.left - rect.width / 2) * strength);
      yTo((event.clientY - rect.top - rect.height / 2) * strength);
    };
    element.addEventListener("pointermove", onMove);
    element.addEventListener("pointerleave", reset);
    window.addEventListener("blur", reset);
    cleanups.push(() => {
      element.removeEventListener("pointermove", onMove);
      element.removeEventListener("pointerleave", reset);
      window.removeEventListener("blur", reset);
      reset();
    });
  }

  const stage = document.querySelector<HTMLElement>("[data-mouse-parallax]");
  if (stage !== null) {
    const layers = Array.from(stage.querySelectorAll<HTMLElement>("[data-mouse-depth]")).map((layer) => {
      const parsed = Number(layer.dataset.mouseDepth);
      return {
        depth: Number.isFinite(parsed) ? parsed : 0.02,
        xTo: gsap.quickTo(layer, "x", { duration: 0.8, ease: "power3.out" }),
        yTo: gsap.quickTo(layer, "y", { duration: 0.8, ease: "power3.out" }),
      };
    });

    if (layers.length > 0) {
      const reset = () => {
        for (const layer of layers) {
          layer.xTo(0);
          layer.yTo(0);
        }
      };
      const onMove = (event: PointerEvent) => {
        const rect = stage.getBoundingClientRect();
        const x = event.clientX - rect.left - rect.width / 2;
        const y = event.clientY - rect.top - rect.height / 2;
        for (const layer of layers) {
          layer.xTo(x * layer.depth);
          layer.yTo(y * layer.depth);
        }
      };
      const onHide = () => {
        if (document.hidden) reset();
      };
      stage.addEventListener("pointermove", onMove);
      stage.addEventListener("pointerleave", reset);
      window.addEventListener("blur", reset);
      document.addEventListener("visibilitychange", onHide);
      cleanups.push(() => {
        stage.removeEventListener("pointermove", onMove);
        stage.removeEventListener("pointerleave", reset);
        window.removeEventListener("blur", reset);
        document.removeEventListener("visibilitychange", onHide);
        reset();
      });
    }
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
