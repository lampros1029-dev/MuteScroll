import type { Transcription } from "../lib/api/types";

/**
 * Illustrative output for the landing page. It is labelled as an example wherever it appears;
 * it is not a real customer video.
 */
export const HERO_EXAMPLE: Transcription = {
  metadata: {
    platform: "instagram",
    content_type: "reel",
    title: "Camera setting in 30 seconds",
    author: null,
    duration_seconds: 31,
  },
  language: "en",
  method: "asr",
  transcript_text: [
    "[00:00] Stop scrolling. This camera setting costs nothing and changes every photo you take.",
    "[00:06] Open the menu, go to Picture Style, and set it to Neutral.",
    "[00:12] Then shoot at ISO 400 for a cleaner night shot.",
    "[00:18] The Lumix S5 does this in one tap. The older model needs two.",
    "[00:26] Save the preset, and you're done.",
  ].join("\n"),
  segments: [
    { start: 0, end: 5.6, speaker: null, text: "Stop scrolling. This camera setting costs nothing and changes every photo you take." },
    { start: 5.6, end: 11.8, speaker: null, text: "Open the menu, go to Picture Style, and set it to Neutral." },
    { start: 11.8, end: 17.9, speaker: null, text: "Then shoot at ISO 400 for a cleaner night shot." },
    { start: 17.9, end: 25.4, speaker: null, text: "The Lumix S5 does this in one tap. The older model needs two." },
    { start: 25.4, end: 31, speaker: null, text: "Save the preset, and you're done." },
  ],
  uncertain_spans: [{ start: 18.2, end: 19.4, text: "Lumix S5", reason: "low_confidence" }],
  on_screen_references: [{ at: 28.5, phrase: "link in my bio" }],
  credits_charged: 1,
};

/**
 * Before/after for the fidelity section. It mirrors what the worker really does (clean_text):
 * collapse repeated whitespace and capitalise the first letter, nothing else. The recogniser's
 * own punctuation and words are kept, and the original line is kept if any number would differ.
 */
export const FIDELITY_EXAMPLE = {
  /** `rawLead` is the lowercase first letter; `rawRest` carries one doubled space the cleanup removes. */
  rawLead: "s",
  rawRest: "o the kit is $10,\u00a0\u00a0and you need the Lumix S5 firmware before you start.",
  formattedLead: "S",
  formattedRest: "o the kit is $10, and you need the Lumix S5 firmware before you start.",
  flagged: "Lumix S5",
  flagReason: "Low confidence. Check the camera name against the audio before you quote it.",
  changed: ["First letter capitalised", "One doubled space removed"],
  kept: ["$10", "Lumix S5", "Every word and the punctuation as recognised"],
} as const;
