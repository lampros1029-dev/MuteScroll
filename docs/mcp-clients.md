# MuteScroll MCP clients

Remote server: `https://api.mutescroll.xyz/mcp`

The endpoint is stateless Streamable HTTP. Each JSON-RPC call is its own `POST`. The server does not issue an `Mcp-Session-Id`. Clients must send `Accept: application/json, text/event-stream` and `Content-Type: application/json`. Cursor and Claude Desktop do that when the server is configured with the URL above.

A public protocol check (`scripts/mcp-smoke.mjs`) sends `initialize` and `tools/list` only. A live client transcription test has not been done.

## Anonymous use, OAuth, and API keys

Leave the `Authorization` header off and the caller is anonymous. Anonymous callers get 5 credits per rolling 24 hours, counted by client IP.

Any plan can connect with OAuth. ChatGPT uses that sign-in. Claude and Cursor can use the same OAuth server when the client supports it.

REST API keys are a Team feature. To call as a Team account with a key, send `Authorization: Bearer YOUR_API_KEY`. `YOUR_API_KEY` is a placeholder. Do not commit a real key. A key that is sent but not valid is rejected. The server does not treat a bad key as anonymous.

## Tools

| Name | What it does |
|---|---|
| `transcribe_video` | Transcribes a public video link into timestamped text when MuteScroll can reach it. Other links get the one-time upload path. |
| `get_transcription` | Reads a transcript job by `job_id`. |

MuteScroll reads a public video link when it can reach it. It does not impersonate a browser, and it does not use a person’s cookies to reach a video. There is no retrieval vendor. A finished result is timestamped text, confidence flags, and exports. MuteScroll does not return video frames. Summaries, translations, and claim checks stay in the assistant.

Calling `transcribe_video` starts work. A finished transcript spends credits. A failed job does not. The smoke script never calls it.

## Cursor

Add the server in **Settings → MCP**, or put this in the project file `.cursor/mcp.json` or the user file `%USERPROFILE%\.cursor\mcp.json`:

```json
{
  "mcpServers": {
    "mutescroll": {
      "url": "https://api.mutescroll.xyz/mcp"
    }
  }
}
```

Team API key (optional):

```json
{
  "mcpServers": {
    "mutescroll": {
      "url": "https://api.mutescroll.xyz/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

Reload the MCP server in Cursor settings after saving. The tool list should show `transcribe_video` and `get_transcription`.

## Claude Desktop

On Windows, the config file is `%APPDATA%\Claude\claude_desktop_config.json`. You can also add a custom connector in **Settings → Connectors** and paste `https://api.mutescroll.xyz/mcp`.

```json
{
  "mcpServers": {
    "mutescroll": {
      "url": "https://api.mutescroll.xyz/mcp"
    }
  }
}
```

Team API key (optional):

```json
{
  "mcpServers": {
    "mutescroll": {
      "url": "https://api.mutescroll.xyz/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

Quit Claude Desktop completely and open it again so it reloads the file. The connector should list `transcribe_video` and `get_transcription`.

## ChatGPT

This is the way to use MuteScroll inside ChatGPT before a directory listing exists.

1. Plugins → Add custom MCP server → `https://api.mutescroll.xyz/mcp` → OAuth.
2. Continue with ChatGPT opens `/connect`. It is MuteScroll’s own OAuth connector, not an OpenAI identity provider. ChatGPT discovers MuteScroll’s sign-in, opens it, and asks the person to allow the connection. Transcripts then use that MuteScroll account. Leave authentication empty only for the anonymous allowance (5 credits per rolling 24 hours, kept for 24 hours). See [https://mutescroll.xyz/plans](https://mutescroll.xyz/plans).
3. Start a new chat, enable the MuteScroll connector, and ask: `Transcribe this public video link.`
4. If the reply is `processing` plus a `job_id`, ask ChatGPT to call `get_transcription` with that id. Do not ask MuteScroll to summarize; ChatGPT does that from the transcript.

A directory submission is a separate step. It needs the privacy and terms review, a tool description that says a public video link or a file upload, and your own OpenAI developer account. The public listing must not mention prices, trials, or discounts.
