import type { Metadata } from "next";
import Link from "next/link";

import { CopyButton } from "../components/copy-button";
import { PasteLinkForm } from "../components/paste-link-form";
import { FlagMark } from "../components/transcript/flag-mark";
import { TranscriptView } from "../components/transcript/transcript-view";
import { FIDELITY_EXAMPLE, HERO_EXAMPLE } from "../content/examples";
import { MCP_URL, SITE_DESCRIPTION } from "../lib/site";

export const metadata: Metadata = {
  title: "Stop rewatching. Start reading.",
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
};

const FAQ: ReadonlyArray<{ readonly question: string; readonly answer: string }> = [
  {
    question: "Which platforms work?",
    answer:
      "YouTube and Shorts: public videos, using captions when they exist. Facebook: public videos. TikTok and Instagram: public posts on a best-effort basis. Retrieval is often blocked, so uploading the file is the reliable route. Upload is always available as the fallback, within the size limit. We never use logins, cookies or workarounds to reach private or restricted content.",
  },
  {
    question: "Do you keep the video?",
    answer:
      "No. We fetch only the audio needed for the transcript, never return the media file, and delete temporary media within 24 hours.",
  },
  {
    question: "What do you store?",
    answer:
      "The link, the transcript, and basic details such as title, author and duration. Anonymous results are kept for 24 hours. Uploads are never shared between users.",
  },
  {
    question: "Do you use my content to train AI?",
    answer: "No. We don't use your media or transcripts to train models.",
  },
  {
    question: "How accurate is it?",
    answer:
      "We don't promise perfect accuracy. Speech recognition makes mistakes, especially with names and noisy audio. We flag the words the model was unsure of, and we keep numbers exactly as spoken. Check names and numbers before you publish.",
  },
  {
    question: "What are the limits?",
    answer:
      "Anonymous use has an allowance of 5 credits per rolling 24 hours. One credit covers up to 10 minutes of audio. Failed jobs never use credits. If a file is too large, the message shows the upload limit.",
  },
  {
    question: "Does MuteScroll summarize or translate?",
    answer:
      "No. MuteScroll returns the text with timestamps. Your assistant (ChatGPT, Claude or Cursor) does the summarizing, translating and analysis, using the transcript in your conversation.",
  },
  {
    question: "Who is responsible for the content?",
    answer:
      "You are. Only process content you have the right to use, and remember that each platform's terms still apply. For takedown requests, see the privacy page.",
  },
];

const MCP_CONFIG = JSON.stringify(
  {
    mcpServers: {
      mutescroll: {
        url: MCP_URL,
      },
    },
  },
  null,
  2,
);

export default function HomePage() {
  return (
    <>
      <section className="hero container" aria-labelledby="hero-title">
        <div className="hero-copy">
          <h1 id="hero-title" className="display">
            Stop rewatching. Start reading.
          </h1>
          <p className="lede">
            Paste a link to a public TikTok, Reel, YouTube or Facebook video and get a timestamped transcript you can
            check, copy, and hand to ChatGPT, Claude or Cursor. Numbers stay as spoken. Unclear words are flagged, not
            guessed.
          </p>
          <PasteLinkForm />
          <p className="fine-print">
            Or <Link href="/try">upload a file</Link> (MP4, MOV, WebM, M4A, MP3 or WAV). Uploads are always available as the fallback.
          </p>
        </div>

        <figure className="hero-sheet">
          <figcaption className="sheet-caption">Example output. Illustrative, not a customer video.</figcaption>
          <TranscriptView transcription={HERO_EXAMPLE} variant="sample" />
        </figure>
      </section>

      <section id="how" className="section container" aria-labelledby="how-title">
        <div className="section-head">
          <p className="kicker">How it works</p>
          <h2 id="how-title" className="section-title">
            From a link to text you can use, in three steps
          </h2>
        </div>
        <ol className="steps">
          <li className="step">
            <span className="step-number" aria-hidden="true">
              01
            </span>
            <h3 className="step-title">Paste a link or drop a file.</h3>
            <p>
              Public YouTube, Shorts, TikTok, Instagram Reel and Facebook video links work. Uploads are always
              available as the fallback, within the size limit.
            </p>
          </li>
          <li className="step">
            <span className="step-number" aria-hidden="true">
              02
            </span>
            <h3 className="step-title">Get a timestamped transcript.</h3>
            <p>
              Platform captions are used when they exist. Otherwise speech recognition runs, and every line keeps its
              timestamp.
            </p>
          </li>
          <li className="step">
            <span className="step-number" aria-hidden="true">
              03
            </span>
            <h3 className="step-title">Use the text where you work.</h3>
            <p>
              Copy it, export SRT, VTT, Markdown, TXT or JSON, or ask ChatGPT, Claude or Cursor to summarize, translate
              or pull the hooks.
            </p>
          </li>
        </ol>
      </section>

      <section id="fidelity" className="section section-band" aria-labelledby="fidelity-title">
        <div className="container">
          <div className="section-head">
            <p className="kicker">Fidelity</p>
            <h2 id="fidelity-title" className="section-title">
              The transcript is the source of truth
            </h2>
            <p className="section-lede">
              Analysis is only as good as the text under it. We change formatting, never meaning, and we say so when we
              are not sure.
            </p>
          </div>

          <figure className="compare" aria-label="Before and after example">
            <div className="compare-col">
              <p className="compare-label">What the speech model returned</p>
              <p className="compare-raw">{FIDELITY_EXAMPLE.raw}</p>
            </div>
            <div className="compare-col compare-col-after">
              <p className="compare-label">What MuteScroll returns</p>
              <p className="compare-text">
                <FidelityFormatted />
              </p>
            </div>
            <figcaption className="compare-caption">
              Illustrative. Only fillers, capitals and punctuation change. The $10 stays $10, and the uncertain name is
              flagged with its reason.
            </figcaption>
          </figure>

          <ul className="rules">
            <li className="rule">
              <h3 className="rule-title">Formatting only.</h3>
              <p>
                We fix punctuation, capitals and filler words such as &ldquo;uh&rdquo;. We never rewrite meaning, so $10
                never becomes $100.
              </p>
            </li>
            <li className="rule">
              <h3 className="rule-title">Unsure means flagged.</h3>
              <p>
                Words the speech model was not confident about are highlighted, with the reason. Check them against the
                audio before you quote them.
              </p>
            </li>
            <li className="rule">
              <h3 className="rule-title">Speakers stay unnamed.</h3>
              <p>
                Voices are labelled Speaker 1, Speaker 2. We never guess who someone is, and we never add names we
                cannot see in the audio.
              </p>
            </li>
          </ul>
        </div>
      </section>

      <section id="connect" className="section container" aria-labelledby="connect-title">
        <div className="section-head">
          <p className="kicker">Use it where you work</p>
          <h2 id="connect-title" className="section-title">
            Connect MuteScroll to your assistant
          </h2>
          <p className="section-lede">
            MuteScroll also runs as an MCP server. Add it to your assistant once, then ask in plain language. The
            assistant fetches the transcript itself and works from the text.
          </p>
        </div>

        <div className="connect-grid">
          <article className="connect-card">
            <h3 className="connect-title">ChatGPT</h3>
            <p>
              Turn on Developer Mode in ChatGPT settings, then add a custom MCP connector with the address below. Then
              ask: &ldquo;Transcribe this: [link]&rdquo;.
            </p>
          </article>
          <article className="connect-card">
            <h3 className="connect-title">Claude</h3>
            <p>
              Open Claude&apos;s connector settings, add a custom connector, and paste the address below. Then ask Claude
              to transcribe a link.
            </p>
          </article>
          <article className="connect-card">
            <h3 className="connect-title">Cursor</h3>
            <p>
              Add this JSON to Cursor&apos;s MCP settings and enable the server. Then ask the agent to transcribe a link
              and summarize it.
            </p>
            <pre className="code-block" aria-label="Cursor MCP configuration">
              <code>{MCP_CONFIG}</code>
            </pre>
          </article>
        </div>

        <div className="endpoint">
          <div>
            <p className="endpoint-label">MCP server address</p>
            <p className="endpoint-url">
              <code>{MCP_URL}</code>
            </p>
            <p className="fine-print">
              Hosted assistants need a public https address. Tools: <code>transcribe_video</code> and{" "}
              <code>get_transcription</code>.
            </p>
          </div>
          <CopyButton label="Copy address" value={MCP_URL} className="btn btn-primary" />
        </div>
      </section>

      <section id="faq" className="section container" aria-labelledby="faq-title">
        <div className="section-head">
          <p className="kicker">Questions</p>
          <h2 id="faq-title" className="section-title">
            Before you paste a link
          </h2>
        </div>
        <div className="faq">
          {FAQ.map((item) => (
            <details key={item.question} className="faq-item">
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="section container closing" aria-labelledby="closing-title">
        <h2 id="closing-title" className="section-title">
          Try it on a real link
        </h2>
        <p className="section-lede">Start with a public video, or upload a file you are allowed to process.</p>
        <Link href="/try" className="btn btn-primary btn-large">
          Open the transcriber
        </Link>
      </section>
    </>
  );
}

/** The formatted line with the one uncertain word flagged. Built from the example constants. */
function FidelityFormatted() {
  const { formatted, flagged, flagReason } = FIDELITY_EXAMPLE;
  const index = formatted.indexOf(flagged);
  if (index < 0) return <>{formatted}</>;
  return (
    <>
      {formatted.slice(0, index)}
      <FlagMark id="fidelity-flag" text={flagged} reason="low_confidence" />
      {formatted.slice(index + flagged.length)}
      <span className="sr-only"> ({flagReason})</span>
    </>
  );
}
