import type { WorkerTranscript } from "../../src/worker/transcript-schema.js";

export function transcriptFixture(durationSeconds = 60): WorkerTranscript {
  return {
    status: "completed",
    source: {
      platform: "youtube",
      content_type: "video",
      title: "Demo",
      author: "Someone",
      duration_seconds: durationSeconds,
    },
    language: "en",
    method: "asr",
    transcript_text: "[00:00] Hello there",
    segments: [{ start: 0, end: 2, speaker: null, text: "Hello there" }],
    uncertain_spans: [],
    on_screen_references: [],
  };
}

/** Bytes that pass the MP4 sniff (`ftyp` at offset 4). */
export function mp4Bytes(): Buffer {
  return Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypmp42"), Buffer.alloc(64)]);
}

export function sampleUrl(id = "dQw4w9WgXcQ"): string {
  return `https://www.youtube.com/watch?v=${id}`;
}
