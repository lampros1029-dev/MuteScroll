import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 } as const;

const PAPER = "#f6f2ea";
const INK = "#1d1b16";
const MUTED = "#4b473d";
const ACCENT = "#b3361b";

/** Social card shared by Open Graph and Twitter. Uses only the default font, so there is no font fetch. */
export function renderOgCard(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          background: PAPER,
          color: INK,
          padding: "72px 84px",
          borderTop: `14px solid ${INK}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", fontSize: 34, letterSpacing: -0.5 }}>MuteScroll</div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 100, lineHeight: 1.02, letterSpacing: -2 }}>
          <span>Stop rewatching.</span>
          <span style={{ color: ACCENT }}>Start reading.</span>
        </div>
        <div style={{ display: "flex", fontSize: 30, color: MUTED, lineHeight: 1.3 }}>
          Timestamped transcripts of public videos and uploads, inside ChatGPT, Claude and Cursor.
        </div>
      </div>
    ),
    { ...OG_SIZE },
  );
}
