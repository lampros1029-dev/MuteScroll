import type { Metadata } from "next";
import Link from "next/link";

import { HomeMotion } from "../components/cinematic/home-motion";
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
    question: "Which links can I try?",
    answer:
      "YouTube and Shorts: public videos, using captions when they exist. Facebook: public videos. TikTok and Instagram: retrieval is tried, and upload is the fallback when a platform blocks it. Upload is always available, within the size limit. We never use logins, cookies or workarounds to reach private or restricted content.",
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

const CHAPTERS: ReadonlyArray<{
  readonly index: string;
  readonly name: string;
  readonly title: string;
  readonly body: string;
}> = [
  {
    index: "01",
    name: "Paste",
    title: "Paste a link or drop a file.",
    body: "We try public YouTube, Shorts, Facebook, TikTok, and Instagram Reel links. When a platform blocks retrieval, upload the file. Upload is the fallback.",
  },
  {
    index: "02",
    name: "Transcribe",
    title: "Get a timestamped transcript.",
    body: "Platform captions are used when they exist. Otherwise speech recognition runs, and every line keeps its timestamp.",
  },
  {
    index: "03",
    name: "Use",
    title: "Use the text where you work.",
    body: "Copy it, export SRT, VTT, Markdown, TXT, DOCX or JSON, or ask ChatGPT, Claude or Cursor to summarize, translate or pull the hooks.",
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

const HERO_LABEL = "Stop rewatching. Start reading.";

export default function HomePage() {
  return (
    <>
      <HomeMotion />
      <section className="cinema-stage" data-mouse-parallax aria-labelledby="hero-title">
        <div className="cinema-inset">
          <div className="container cinema-frame">
            <p className="cinema-slate">A public video, as text</p>
            <h1 id="hero-title" className="display cinema-title" aria-label={HERO_LABEL}>
              <span className="cinema-line" aria-hidden="true" data-motion-text="words">
                Stop rewatching.
              </span>
              <span className="cinema-line" aria-hidden="true" data-motion-text="words">
                Start reading.
              </span>
            </h1>
            <div className="cinema-copy">
              <p className="lede">
                Paste a public YouTube, Facebook, TikTok, or Reel link. Retrieval is tried, and upload is the fallback
                when a platform blocks it. You get a timestamped transcript you can check, copy, and hand to ChatGPT,
                Claude or Cursor. Numbers stay as spoken. Unclear words are flagged, not guessed.
              </p>
              <PasteLinkForm />
              <p className="fine-print">
                Or <Link href="/try">upload a file</Link> (MP4, MOV, WebM, M4A, MP3 or WAV). Uploads are always available as
                the fallback.
              </p>
            </div>
            <figure className="caption-sheet">
              <figcaption className="sheet-caption">Example output. Illustrative, not a customer video.</figcaption>
              <div className="caption-paper" data-mouse-depth="0.02">
                <TranscriptView transcription={HERO_EXAMPLE} variant="sample" />
              </div>
            </figure>
          </div>
        </div>
      </section>

      <section id="how" className="section chapters" data-chapter-scene aria-labelledby="how-title">
        <div className="container">
          <div className="section-head">
            <p className="kicker">How it works</p>
            <MotionHeading id="how-title" className="section-title" text="From a link to text you can use, in three steps" />
          </div>
          <div className="chapter-block">
            <div className="chapter-rail" aria-hidden="true">
              <span className="chapter-rail-fill" data-chapter-progress />
            </div>
            <ol className="chapter-list" data-reveal-group>
              {CHAPTERS.map((chapter) => (
                <li key={chapter.index} className="chapter" data-reveal-item>
                  <p className="chapter-index" aria-hidden="true">
                    {chapter.index}
                  </p>
                  <div className="chapter-copy">
                    <p className="kicker">{chapter.name}</p>
                    <h3 className="chapter-title">{chapter.title}</h3>
                    <p>{chapter.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section id="fidelity" className="section section-band" aria-labelledby="fidelity-title">
        <div className="container">
          <div className="section-head">
            <p className="kicker">Fidelity</p>
            <MotionHeading id="fidelity-title" className="section-title" text="The transcript is the source of truth" />
            <p className="section-lede">
              Analysis is only as good as the text under it. We change formatting, never meaning, and we say so when we
              are not sure.
            </p>
          </div>

          <figure className="compare" data-reveal aria-label="Before and after example">
            <div className="compare-col">
              <p className="compare-label">What the speech model returned</p>
              <p className="compare-raw">
                <FidelityRaw />
              </p>
            </div>
            <div className="compare-col compare-col-after">
              <p className="compare-label">What MuteScroll returns</p>
              <p className="compare-text">
                <FidelityFormatted />
              </p>
            </div>
            <div className="compare-ledger">
              <p className="compare-label">Changed</p>
              <ul className="ledger-list">
                {FIDELITY_EXAMPLE.changed.map((item) => (
                  <li key={item} className="ledger-item ledger-changed">
                    {item}
                  </li>
                ))}
              </ul>
              <p className="compare-label">Kept exactly</p>
              <ul className="ledger-list">
                {FIDELITY_EXAMPLE.kept.map((item) => (
                  <li key={item} className="ledger-item">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <figcaption className="compare-caption">Illustrative example, not a customer video.</figcaption>
          </figure>

          <ul className="rules" data-reveal-group>
            <li className="rule" data-reveal-item>
              <h3 className="rule-title">Formatting only.</h3>
              <p>
                We tidy spacing and the first capital letter, nothing else. We never rewrite words, and if a number
                would differ after cleanup, we keep the original line, so $10 never becomes $100.
              </p>
            </li>
            <li className="rule" data-reveal-item>
              <h3 className="rule-title">Unsure means flagged.</h3>
              <p>
                Words the speech model was not confident about are highlighted, with the reason. Check them against the
                audio before you quote them.
              </p>
            </li>
            <li className="rule" data-reveal-item>
              <h3 className="rule-title">Speakers stay unnamed.</h3>
              <p>
                When a transcript already includes speakers, they are shown as Speaker 1, Speaker 2, in the order they
                appear. MuteScroll does not name people. Separating voices is not a control on this site.
              </p>
            </li>
          </ul>
        </div>
      </section>

      <section id="connect" className="section container" aria-labelledby="connect-title">
        <div className="section-head">
          <p className="kicker">Use it where you work</p>
          <MotionHeading id="connect-title" className="section-title" text="Connect MuteScroll to your assistant" />
          <p className="section-lede">
            MuteScroll also runs as an MCP server. Add it to your assistant once, then ask in plain language. The
            assistant fetches the transcript itself and works from the text.
          </p>
        </div>

        <div className="connect-grid" data-reveal-group>
          <article className="connect-card" data-reveal-item>
            <h3 className="connect-title">ChatGPT</h3>
            <p>
              Turn on Developer Mode, add a custom MCP connector with the address below, and choose OAuth. ChatGPT
              opens MuteScroll so you can sign in and connect that account. Then ask: &ldquo;Transcribe this:
              [link]&rdquo;.
            </p>
          </article>
          <article className="connect-card" data-reveal-item>
            <h3 className="connect-title">Claude</h3>
            <p>
              Open Claude&apos;s connector settings, add a custom connector, and paste the address below. Then ask Claude
              to transcribe a link.
            </p>
          </article>
          <article className="connect-card" data-reveal-item>
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
              <code>get_transcription</code>. <Link href="/developers">Setup for ChatGPT, Claude, and Cursor</Link>.
            </p>
          </div>
          <CopyButton label="Copy address" value={MCP_URL} className="btn btn-primary" />
        </div>
      </section>

      <section id="faq" className="section container" aria-labelledby="faq-title">
        <div className="section-head">
          <p className="kicker">Questions</p>
          <MotionHeading id="faq-title" className="section-title" text="Before you paste a link" />
        </div>
        <div className="faq" data-reveal-group>
          {FAQ.map((item) => (
            <details key={item.question} className="faq-item" data-reveal-item>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="closing-band" aria-labelledby="closing-title">
        <div className="container closing">
          <MotionHeading id="closing-title" className="section-title" text="Try it on a real link" />
          <p className="section-lede">Start with a public video, or upload a file you are allowed to process.</p>
          <Link href="/try" className="btn btn-primary btn-large" data-magnetic>
            Open the transcriber
          </Link>
        </div>
      </section>
    </>
  );
}

function MotionHeading({
  id,
  className,
  text,
}: {
  readonly id: string;
  readonly className: string;
  readonly text: string;
}) {
  return (
    <h2 id={id} className={className} aria-label={text}>
      <span aria-hidden="true" data-motion-text="words">
        {text}
      </span>
    </h2>
  );
}

/** The formatted line with the one uncertain word flagged. Built from the example constants. */
function FidelityFormatted() {
  const { formattedLead, formattedRest, flagged, flagReason } = FIDELITY_EXAMPLE;
  const index = formattedRest.indexOf(flagged);
  const lead = <mark className="diff diff-add">{formattedLead}</mark>;
  if (index < 0) {
    return (
      <>
        {lead}
        {formattedRest}
      </>
    );
  }
  return (
    <>
      {lead}
      {formattedRest.slice(0, index)}
      <FlagMark id="fidelity-flag" text={flagged} reason="low_confidence" />
      {formattedRest.slice(index + flagged.length)}
      <span className="sr-only"> ({flagReason})</span>
    </>
  );
}

/** The recogniser's line with the two things cleanup touches marked: the first letter and a doubled space. */
function FidelityRaw() {
  const { rawLead, rawRest } = FIDELITY_EXAMPLE;
  const [before = "", after = ""] = rawRest.split("\u00a0\u00a0");
  return (
    <>
      <mark className="diff diff-del">{rawLead}</mark>
      {before}
      <mark className="diff diff-del diff-gap">{"\u00a0\u00a0"}</mark>
      {after}
    </>
  );
}
