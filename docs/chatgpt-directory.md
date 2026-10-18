# ChatGPT directory draft

This file is a draft, not a submission. MuteScroll has not been submitted to the ChatGPT directory, and it has not been approved. Directory submission stays blocked until counsel reviews yt-dlp retrieval.

The package to review later is `chatgpt-plugin/` at the repo root. It is not uploaded here. Reviewer sign-in stays in the OpenAI review form, outside this repo.

## Connect before a listing exists

Plugins → Add custom MCP server → `https://api.mutescroll.xyz/mcp` → OAuth.

ChatGPT registers a client with MuteScroll and opens MuteScroll’s own sign-in. Allow the connection. Transcripts then use that MuteScroll account.

Continue with ChatGPT is MuteScroll’s OAuth connector, not an OpenAI identity provider. On the MuteScroll page, sign in with email or Google first. Continue with ChatGPT then lets ChatGPT use that MuteScroll account.

The server reads a public video link when it can reach it. The video’s own captions are used when they exist. Otherwise the audio is transcribed. If the audio cannot be fetched, automatic captions from the public page are used when the video has them (`captions_auto`). The server does not sign in, does not impersonate a browser, and does not use a person’s cookies to reach a video. If retrieval fails, the tool returns a one-time upload link. There is no retrieval vendor. MuteScroll returns timestamped text, confidence flags, and exports. It does not return video frames. Summaries, translations, and claim checks stay in the assistant.

A limit message may include https://mutescroll.xyz/plans. That link is informational.

The listing fields, example prompts, and the cases below must not name a video host.

## Listing fields in the package

| Field | Value |
|---|---|
| Name | MuteScroll |
| Privacy | https://mutescroll.xyz/privacy |
| Terms | https://mutescroll.xyz/terms |
| Support | mutescroll.xyz@gmail.com |
| Example prompts | Each one says “Transcribe this public video link.” |

## Positive cases

Replace the placeholders with a public video link you have the right to process, a short public video link, a private or unreachable link, and a file you have the right to upload. A passing run calls MuteScroll only on cases 1–5.

1. **A reachable public video link.** Prompt: `Transcribe this public video link: PUBLIC_VIDEO_LINK`. Expect one `transcribe_video` call. A finished job returns timestamped text. A job that is still running returns `processing` and a `job_id`.

2. **A short public video link.** Prompt: `Transcribe this public video link: SHORT_PUBLIC_VIDEO_LINK`. Expect one `transcribe_video` call. A short video that finishes in the first response returns timestamped text and no second call.

3. **A processing job.** Prompt: `The transcript is still processing. Fetch it. The job id is JOB_ID.` Expect `get_transcription` with that `job_id`, and no new `transcribe_video` call. While the status stays `processing`, poll `get_transcription` with the same `job_id`.

4. **`get_transcription` after upload.** Start from a retrieval failure that returned `upload_url`. Open that link, upload the file, then prompt: `The file is uploaded. Fetch the transcript. The job id is JOB_ID.` Expect one `get_transcription` call with that `job_id`. If it is still `processing`, poll that same id. Do not call `transcribe_video` again.

5. **A completed transcript with uncertain spans.** When `transcribe_video` or `get_transcription` returns `completed` and `uncertain_spans` is present, show the timestamped text and flag those spans. Leave every number unchanged. Speakers, when present, are “Speaker N”. Do not call either tool again to inspect the spans.

## Negative cases

6. **A summary that must not call MuteScroll.** Prompt: `Summarize the transcript above in one short paragraph. Use only the text already in this chat.` Expect zero MuteScroll tool calls. The host writes the summary from the transcript it already has.

7. **A translation that must not call MuteScroll.** Prompt: `Translate the transcript above. Use only the text already in this chat.` Expect zero MuteScroll tool calls. The host translates the transcript it already has.

8. **A private or unreachable link.** Prompt: `This link is private or unreachable. Do not sign in. Link: PRIVATE_OR_UNREACHABLE_LINK`. Expect `transcribe_video` to fail closed and return an `upload_url`. Give that one-time upload link to the person. There must be no attempt to log in or bypass access controls, and no second retrieval call.

## Owner checklist

Do these yourself. This file does not do them.

- [x] The published pages are `/privacy`, `/terms`, `/refunds`, `/legal`, and `/subprocessors`.
- [x] Operator name is Labros Aggelopoulos. The published address is Arionos 17, Peristeri, Greece.
- [ ] Counsel reviews yt-dlp retrieval before any directory submission.
- [ ] Submit the listing from your own OpenAI account, only after that review. Do not treat this document as a submission.
- [ ] Confirm the directory source limits: a public video link, and a file upload. The package description does not name a video host.
- [ ] If a limit message names a plans page, it is only https://mutescroll.xyz/plans, and it stays informational.
