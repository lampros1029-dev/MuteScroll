## Learned User Preferences

- Host-LLM follow-ups stay outside MuteScroll. Summarize, translate (including to Greek), "is this correct?", and "strongest claims" are done by ChatGPT, Claude, or Cursor. MuteScroll returns timestamped text, confidence flags, frames, and exports.
- Use the Hormozi tools for pricing, sales, and copy.
- TikTok and Reels are essential. Start on vendor free tiers, and do not become our own retrieval vendor. Cap vendor pilots and leave a credit reserve.
- Store API keys and account secrets in gitignored `.secrets`, and mirror them into gitignored `.env` for local runs. Never commit or paste those values.
- Keep implementing in parallel, including subagents, until the next step needs the user. Marketing work should use the design skills and aim for a cinematic, award-quality site without claiming an award was won.
- Sell on Paddle as an Individual until a company is registered.
- Paddle skills live in `C:\Users\lampr\.cursor\skills\paddle-*` and must not be committed inside the MuteScroll repo.

## Learned Workspace Facts

- Repo is `github.com/lampros1029-dev/MuteScroll` at `D:\MuteScroll`. Workspaces: `apps/web` (`@mutescroll/web`, Next.js, plain CSS, no Tailwind or UI kit), `apps/api-mcp` (TypeScript MCP and REST), `workers/media` (Python plus ffmpeg), `packages/shared`. The shell is Windows PowerShell; do not use bash heredocs.
- `mutescroll.xyz` was bought at Namecheap and DNS is on Cloudflare. `https://mutescroll.xyz` and `https://www.mutescroll.xyz` serve the site. `https://api.mutescroll.xyz` serves the API, with MCP at `/mcp`. Checkout is `https://mutescroll.xyz/checkout`. Legal pages are `/terms`, `/privacy`, and `/refunds`. Billing success is `/billing/success`. Compute is the Railway project `mutescroll`.
- Billing is Paddle, merchant of record, behind an interface so Stripe can replace it later. A sandbox catalog exists. Live migration is in progress and must be additive: never delete or recreate live Paddle products, prices, discounts, or notification destinations. The ChatGPT app cannot sell, show prices, or upsell; checkout lives on the website.
- ChatGPT account connect is OAuth. REST API keys are Team-only. OAuth works on every plan.
- Speech-to-text is Groq (the user says "Grok" for this). YouTube and public Facebook use captions or yt-dlp. TikTok and Instagram use ScrapeCreators for a CDN media URL, then our worker and Groq; Supadata is transcript failover and must be labelled as vendor captions. No browser impersonation and no user cookies on our servers. Upload is always the fallback.
- Fidelity rules: formatting only, numbers never changed, uncertain words flagged, speakers only as "Speaker N". Do not claim filler words are removed. One credit is up to 10 minutes. Anonymous use is 5 credits per rolling 24 hours, with 24-hour retention.
- Product contact and vendor sign-ups use `mutescroll.xyz@gmail.com`. Gmail send uses an OAuth client for that address. While the Google app is in Testing, the refresh token expires after 7 days. Legal review is required before a ChatGPT directory submission; the web, API, Claude, and Cursor surfaces ship first.
- `.secrets` and `.env` are gitignored. Production secrets belong in Railway or Cloudflare, not in the repo.
