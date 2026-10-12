# ChatGPT directory paste packet

This file is a paste packet for the owner. It is not a submission. MuteScroll has not been submitted to the ChatGPT directory, and it has not been approved.

Developer Mode can be used today. In ChatGPT, turn on Developer Mode, add a custom MCP connector named MuteScroll, and set the server URL to `https://api.mutescroll.xyz/mcp`.

ChatGPT connector auth for an account is OAuth. Choose OAuth, sign in on MuteScroll, and allow the connection. Transcripts then use that account. Anonymous use remains available only if authentication is left empty. That choice is separate from a directory listing.

The live connector may still accept TikTok, Instagram, and Facebook links. The directory listing must not. Do not put those platform names in the directory description, the test prompts, or any other field you paste into the directory form. Do not put prices, trials, discounts, or the word "save" in any directory field.

## Paste into the form

**App name**

MuteScroll

**Description**

MuteScroll turns a public YouTube video, a YouTube Short, or a file you upload into timestamped text of the spoken words. Use it when someone asks for a transcript, subtitles, or what a video says. A link works only for a public YouTube video or Short. A private, blocked, or unavailable video needs a file upload of a copy the person has the right to use. MuteScroll returns the transcript and stops. Summaries, translations, and other follow-ups stay in the chat and must not call MuteScroll again.

**Privacy policy URL**

https://mutescroll.xyz/privacy

**Terms URL**

https://mutescroll.xyz/terms

**Support email**

mutescroll.xyz@gmail.com

## Test prompts

Replace the placeholders before a reviewer runs these. Use a public YouTube video you have the right to process, a public YouTube Short, a private or unavailable YouTube link that should fail closed, and a short video file you have the right to upload. A passing run calls MuteScroll only on prompts 1–4. Prompt 5 must not call MuteScroll.

1. Transcribe this public YouTube video: `https://www.youtube.com/watch?v=VIDEO_ID`
   Expect one `transcribe_video` call. A finished job returns timestamped text. A job that is still running returns `processing` and a `job_id`.

2. Transcribe this YouTube Short: `https://www.youtube.com/shorts/SHORT_ID`
   Expect one `transcribe_video` call and the same kind of result as prompt 1.

3. This video is not public. Do not try to sign in. I will upload a file I have the right to use: `https://www.youtube.com/watch?v=PRIVATE_OR_UNAVAILABLE_ID`
   Expect `transcribe_video` to refuse retrieval and return a one-time upload link. Open that link, upload the file, then ask for the transcript of that `job_id`. Expect one `get_transcription` call after the upload. There must be no attempt to bypass a login, a bot check, or other access controls.

4. The transcript is still processing. Fetch it. The job id is `JOB_ID`.
   Expect one `get_transcription` call with that `job_id`, and no new `transcribe_video` call.

5. Summarize the transcript above in one short paragraph. Use only the text already in this chat.
   Expect zero MuteScroll tool calls. The host writes the summary from the transcript it already has. Do not call `transcribe_video` or `get_transcription` again.

## Owner checklist

Do these yourself. This file does not do them.

- [x] The published pages are `/privacy`, `/terms`, `/refunds`, `/legal`, and `/subprocessors`.
- [x] Operator name is Labros Aggelopoulos, Athens, Greece, in `apps/web/src/lib/legal.ts`.
- [x] Consumers keep the mandatory rights and courts of the country where they live. Business customers use Greek law and the courts of Athens. The legal notice states Article 44a of Law 5144/2024 (€10,000 Greek VAT exemption) and Article 11 of Law 5104/2024 (commencement declaration before the first business transaction).
- [ ] Submit the listing from your own OpenAI account. Do not treat this document as a submission.
- [ ] Confirm you accept the directory source limits: public YouTube videos, YouTube Shorts, and file upload. The directory description above is the text to paste. It does not name other platforms.
- [ ] Keep prices, trials, discounts, comparisons, and the word "save" out of every directory field, including the description above.
