# EBG Lead Performance Dashboard — notes for Claude

Read this first. It carries the decisions and rules agreed while building this project, so work can continue in a new session.

## Who and what
- Owner / main user: **Navath** (Performance Marketer, EBG Group, Hyderabad). Answer as a performance marketer would: business impact first, plain language, no jargon dumps.
- The chairman uses this dashboard, so **accuracy is critical**: never invent numbers, targets, values, actors or events. Use N/A when data is missing or a denominator is 0 — never 0.
- The dashboard compares **Meta Ads (and optionally Google Ads) with TeleCRM leads** per brand: spend, Meta leads, TeleCRM leads, qualified leads (QL), CPL, CPQL, TAT, lead leaks, reports.
- Live site: https://ebg-dashboard.vercel.app (Vercel, auto-deploys from `main` of this private GitHub repo).

## Architecture
- `index.html` — the whole dashboard: one file, **ES5 JavaScript** (`var`, `function`, no build step, no arrow functions or modules). Engine between `ENGINE START` / `ENGINE END` (`processData`). Helpers: `el`, `table`, `render`, `state`, `FMT` (`rint`, `rinr`, `rpct`, `rpct2`), `provApi`, `alertsApi`, `alertsAllowed()`, `myPrefs` / `saveMyPrefs`.
- `api/*.js` — Vercel serverless functions (Node 18+, CommonJS). Files starting with `_` are shared libraries, not endpoints:
  - `meta.js`, `meta-cron.js` (Meta sync every 30 min), `_metalib.js` (Graph API; `result()` decides what counts as a lead), `_forms.js` (lead forms)
  - `crm-push.js` (TeleCRM leads pushed by n8n), `team.js`, `config.js`
  - `google.js`, `google-cron.js`, `_gadslib.js`, `_gadsync.js` (Google Ads; optional, not yet set up)
  - `alerts.js` (all ops recipient-only), `alerts-cron.js` (`mode=activity` every 5 min, `mode=summary` every 30 min)
  - `_alertlib.js` (Telegram linking, CPL events, old summary as fallback), `_activity.js` (Meta change log → plain language, "META ACCOUNT CHANGE DETECTED" block)
  - `_monitor.js` (alert detection, open/resolved issue tracking, anti-spam, 30-min update, scheduling), `_reports.js` (full brand-wise DAILY and WEEKLY Telegram reports, split into numbered parts), `_insights.js` (Trends › Updates & issues), `_tg.js` (Telegram send)
- `supabase/*.sql` — database changes. Supabase = Postgres + Auth + RLS (`private.team_role()`) + PostgREST + pg_cron/pg_net + Vault key `meta_cron_key` (checked by RPC `meta_cron_key_ok`).
- `n8n/telecrm-to-dashboard.json` — n8n workflow pushing TeleCRM leads to `/api/crm-push`.
- `tests/monitor.test.js` — `npm test` (no network, no real data; Supabase / Meta / Telegram faked).

## Agreed definitions (do not change without asking)
- **Meta leads** = Meta "Results" of lead / chat / website-lead rows (`result_indicator ~* 'lead|form|messag|conversation|whatsapp'`). Traffic campaigns count WhatsApp chats / form / website leads, never link clicks or landing page views. Excluded campaigns' results are left out (their spend still counts).
- **TeleCRM leads** = leads by created day (IST wall-clock, `created_on` is `timestamp` without zone); repeat leads (`prev_lead` not null) left out. **QL** = qualified statuses (Settings › QL statuses).
- CPL = spend ÷ Meta leads; CPQL = spend ÷ QL; CTR = link clicks ÷ impressions; CPC = spend ÷ link clicks; CPM = spend ÷ impressions × 1,000. Blended / overall figures from **summed totals**, never averages of brand ratios.
- **Overall totals = sum of the listed brands** (Settings › Brands). Spend outside them (Unmapped) is shown separately, never silently added. Always show a totals check.
- **TAT** = working hours. **New Lead** statuses = New Lead, New, Fresh. **Monthly target** spread over all days of the month. **Leader** = TeleCRM manager. Targets: Settings › Report targets, per month (`S.report.months[YYYY-MM].brands[brand]`: budget, leads, cpl).
- Days are IST. Meta leads by Meta's reporting day; TeleCRM by created day — small same-day gaps are timing, not lost leads.
- Reach can't be added across ads / days / accounts: shown only for a brand with exactly one own ad account whose spend equals the brand's; otherwise N/A with the reason.

## Rules
- **Never ask for or accept API keys, tokens or passwords in chat.** The user enters them in Vercel env vars, GitHub, n8n or BotFather.
- **Database changes**: write a new, non-destructive SQL file in `supabase/`; the user runs it in Supabase › SQL Editor (no MCP / direct DB access). Never drop or overwrite production data or settings without approval.
- **Alerts and monitoring are private** to the alert recipient's login (`shettyharikrishna…`, or `S.alerts.recipient`): client `alertsAllowed()`, server `isRecipient`. Covers Settings › Alerts, Alerts & Monitoring, Ad account activity, Trends private panels.
- Personal view settings (columns, included / excluded campaigns) are per login in `user_prefs`, not team settings.
- Don't commit real data. Keep tokens server-side only.
- Before pushing: `node --check` on changed `api/*.js`, syntax-check the inline script of `index.html`, `npm test`. Keep the dashboard working at phone width (no horizontal scroll).
- Reuse existing helpers, tables and settings; don't create duplicates. Don't rebuild — extend.

## Vercel environment variables (names only)
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `META_ACCESS_TOKEN`, `META_API_VERSION`, `META_CRON_BUDGET_MS`, `CRON_SECRET`, `CRM_PUSH_KEY`, `TELEGRAM_BOT_TOKEN`, `DASHBOARD_URL`, `TEAM_PASSCODE`, `TEAM_ADMIN_PASSCODE`, `BLOB_READ_WRITE_TOKEN`, `GOOGLE_ADS_*` (optional).

## SQL files run so far
Run and verified: `schema.sql`, `meta-autosync-scheduler.sql`, `change-history.sql`, `alerts.sql`, `user-prefs.sql`, `creative-report.sql`.
Not run yet: **`monitoring.sql`** (issue list + `mon_brand_daily` / `mon_campaign_daily`; until then alerts fall back to the old 30-min update and impressions/clicks show N/A), `google-ads.sql` (only if Google Ads is set up).

## Pending (user side)
- Run `supabase/monitoring.sql`.
- Telegram: create the bot in BotFather, set `TELEGRAM_BOT_TOKEN` in Vercel, then Hari connects it in Settings › Alerts.
- Meta: "Sync now" for older dates (to backfill Ad IDs and the Traffic-campaign lead fix); assign Facebook Pages to the system user so lead form names show.
- Google Ads setup (optional).

## Ideas discussed, not built
- Google Ads Script as an alternative to the Google Ads API.
- Moving from Supabase to AWS (self-hosted Supabase on EC2 in ap-south-1 was the recommended route if ever needed); not started.
- Frequency trends (needs a separate reach query).
