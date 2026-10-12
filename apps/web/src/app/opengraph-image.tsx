import { OG_SIZE, renderOgCard } from "../components/og-card";

export const alt = "MuteScroll: stop rewatching, start reading";
export const size = OG_SIZE;
export const contentType = "image/png";

export default function OpengraphImage() {
  return renderOgCard();
}
