---
name: transcribe-public-video
description: Transcribe a public video. Use when someone asks to transcribe a public video link, get its subtitles, or asks what a public video says. MuteScroll reads a public video link when it can reach it; other links get the one-time upload path.
---

# Transcribe a public video

MuteScroll reads a public video link when it can reach it. Other links get the one-time upload path.

## Tools

Call `transcribe_video` once. Its `url` is the public video link. Pass `language` only when the person names one: `auto`, or an ISO 639-1 code such as `en` or `el`.

If the status is `processing`, poll `get_transcription` with that `job_id` until the status is `completed` or `failed`. Do not start another `transcribe_video` for the same request.

If retrieval fails, return the `upload_url` on the error. That is the one-time upload path. After the person uploads a file they have the right to use, call `get_transcription` with the same `job_id`, and poll while it is still processing.

Do not sign in. Do not bypass access controls.

Do not call MuteScroll again to summarize, translate, or check claims. Do that in the chat from the transcript text already returned.

## Fidelity

- Return the timestamped text. Formatting is spacing and a leading capital only. Do not rewrite words.
- Do not change numbers. If a number would differ, keep the original line.
- Flag uncertain spans. Each entry in `uncertain_spans` has `start`, `end`, `text`, and `reason`. Tell the person to check those words against the audio before quoting them.
- Speakers are "Speaker N", numbered by first appearance. Do not turn a speaker label into a person's name.
- Do not claim filler words are removed.
- `captions_auto` means automatic captions from the public page. They are used when the audio cannot be fetched and those captions exist. Say that in plain language.
- MuteScroll does not return video frames.

If a message includes https://mutescroll.xyz/plans, pass that link through as information.
