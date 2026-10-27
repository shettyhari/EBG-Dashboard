# EBG In-House Performance Marketing Dashboard

A single-page dashboard that compares **Meta Ads leads (Leads in UI)** with **TeleCRM leads** for the EBG brands, at brand, campaign, ad set and ad level. Everything runs in the browser: open `index.html`, load the two exports, and the report builds itself. Nothing is uploaded anywhere.

## Brands
Adhira & Appa · Acer · Carlton · Natuf · Tarzan · Shayreen by Natuf · Bonumcha · Chhota Bheem · EBG Rental.
A campaign's brand comes from keywords in its name (e.g. `AAC` → Adhira & Appa, `Shayreen` → Shayreen by Natuf, checked before `Natuf`). Edit brands and keywords under **Settings**.

## Daily use
1. **Meta Ads Manager** → export the ads report (CSV or XLSX) — one per brand or one for everything; add as many as you like and they are combined. Any column order works; the page finds the columns by name:
   Campaign name · Ad set name · Ad name · Amount spent (any currency) · **Results** (or Leads if there is no Results column) · Reporting starts/ends or Day.
   Add *Breakdown › By time › Day* if you want to filter Meta spend and results by date.
2. **TeleCRM** → export leads for the same dates (all columns are fine).
3. Open the dashboard → **Load exports** → drop all Meta reports in the first box and the TeleCRM export in the second. Add or remove Meta files any time; the same file added twice is skipped.
4. Pick dates with the date picker (Today, Yesterday, Last 7/14/28/30 days, This/Last week, This/Last month, Maximum or a custom range) and a brand with the chips.

## What it shows
| Tab | Contents |
|---|---|
| Overview | Spend, Leads in UI, Leads in CRM, lead difference, CPL, QLs, CPQL, first-call TAT, SLA %, calls pending; brand summary; charts |
| Campaigns / Ad sets / Ads | Leads in CRM, Leads in UI, difference and %, platform, CPL, QLs, CPQL, spend, TAT, SLA %, pending calls, auto remarks; sortable, searchable, totals follow filters |
| TAT & calls | First-call TAT by owner and the list of leads still to call |
| Data checks | Row reconciliation (rows pasted = in report + left out + outside dates), columns used, unmatched leads |
| QL statuses | Which TeleCRM statuses count as qualified (intent-based, with overrides) |
| Settings | SLA, targets, brands, keywords, counting rules, QL words, column names |

## TAT, holidays and reports
- **Overall TAT** = Created On → First Attempted Call, all hours. **Working-hours TAT** counts only Mon–Sat, 10:00 AM–9:00 PM IST, skipping Sundays and active holidays; a lead created outside those hours starts counting at the next working interval. Both show average and median wherever TAT appears; **Not Contacted** leads are counted separately with how long they have been waiting (overall and in working hours). The SLA (≤ 30 min by default, Settings) uses overall TAT.
- **Settings › Holidays**: add, edit, delete (with confirmation), activate or deactivate, search and filter by year. The 2026 list is pre-loaded once; changes recalculate working-hours TAT straight away and, with the team database, are shared with everyone. Holidays never change overall TAT.
- Contact status labels: **Not Contacted** (no first call yet), **Call delayed** (first call after the SLA), **Contacted** (called).
- **Brand view**: pick a brand chip for its own dashboard (spend, impressions, reach, clicks, CTR, CPC, Leads in UI and CRM, lead status breakdown, CPL, CPQL, TAT, SLA). Reach is shown only where it comes from a single Meta row, because reach can't be added across days or ads.
- **Customize columns** on each report (saved in the browser); Excel uses the same columns unless *Export all columns* is ticked.
- **Campaigns tab**: Campaign → Ad set → Ad tree with expand / collapse, search that opens matching branches, and sorting within each level. Totals add campaigns only; CTR, CPC and CPL are recalculated from totals. Excel gets a *Campaign hierarchy* sheet with outline groups.

## Reports tab (EBG templates)

Sidebar › **Reports**. Pick a report, brands (empty = all), dates, then **Generate**. **Export Excel** downloads exactly what is on screen (same columns, same order, numbers kept as numbers).

| Report | Columns |
|---|---|
| FTD Brand-wise | Date, Brand Name, Spend, CPL, Leads Target, Leads Achieved, Lead Achievement %, Contacted LQ %, Overall LQ %, TAT (Hrs), New Lead %, Remarks — a day (or From–To range) |
| FTD Leader-wise | Date, Leader Name, Total Spend, Leads Target, Leads Achieved, Lead Achievement %, Contacted LQ %, Overall LQ %, FC TAT (Hrs), New Lead % — a day (or range) |
| MTD Brand-wise | same as FTD Brand-wise, 1st of month → reporting date |
| MTD Leader-wise | same as FTD Leader-wise, 1st of month → reporting date |
| Master (FTD + MTD; also the "expanded MTD" report — one template) | the 22 columns of the Master Report |

Spend of campaigns that match no brand ("Unmapped") is left out of every report (same as the Overview), and the report shows a note with the amount.

Definitions (shown on the page under "How each number is calculated"):

- **FTD** = the reporting day (cutoff). **MTD** = 1st of the cutoff's month → cutoff. Default cutoff = latest complete day with data.
- **Leads Achieved / Platform leads** = Meta leads (Ads Manager "Results"). **CRM leads** = TeleCRM leads matched to those ads.
- **CPL** = spend ÷ platform leads. **Lead Sync %** = CRM leads ÷ platform leads (same as the Overview).
- **Lead Achievement %** = achieved ÷ target. Targets are entered **per month** (monthly totals); per-day target = monthly ÷ days in that month, period target = per-day × days. A period touching a month with no target shows "—".
- **Allocated budget** = monthly budget ÷ days in month × days. **Spend %** = actual ÷ allocated.
- **CPL Target Achievement %** (Master) = target CPL ÷ actual CPL (over 100% = cheaper than target).
- **Contacted LQ %** = qualified ÷ leads that were called. **Overall LQ %** = qualified ÷ all CRM leads. Qualified = the statuses ticked in Settings › Rules.
- **New Lead %** = leads still in a "new" status ÷ CRM leads (statuses listed in Settings › Report targets).
- **TAT (Hrs)** = average first-call time in working hours (same schedule, Sundays and holidays as the TAT page). Can be switched to all hours.
- **Leader** = the TeleCRM Assignee Manager who owns most of a campaign's leads (or campaign-word rules you enter). A lead uses its current manager.
- **Totals** are recomputed from summed numbers, never averaged percentages. "—" means no data/target (different from 0).
- Markers: ✓ on/above target, ! close, ✗ off (achievement ≥100/≥80%, sync ≥95/≥85%, FTD spend 80–110%/50–130%, MTD spend ≤100/≤110%).

**Confirmed by Navath (26 Oct 2026):** TAT = working hours (Mon–Sat 10 AM–9 PM, Sundays/holidays skipped) · New Lead % statuses = New Lead, New, Fresh · monthly targets spread over all days of the month · leader = TeleCRM Assignee Manager owning most of a campaign's leads · ✓/!/✗ cut-offs as listed above.

Targets are entered month by month in **Settings › Report targets**: pick the month, enter monthly lead targets, target CPL and monthly budgets (and leader targets), Save. "Copy from <last month>" starts a new month from the previous one; "Fill budgets from Meta" = today's daily Meta budget × days in the month.

## Telegram alerts

Settings › **Alerts**. Private to one person (the shettyharikrishna login): only that login sees the Alerts tab and its History lines, and the server refuses alert requests from anyone else. Alerts go to that person's private Telegram chat:
- **Ad account changes** — checked every 5 minutes from Meta's account activity log: who (person or app) changed what (budget, on/off, new or edited ads, targeting, bids…), on which campaign / ad set / ad, with old → new values when Meta gives them. Only new changes, never repeated.
- **CPL alerts** — per brand, once today's CPL moves ±20% (adjustable) vs its last 7 days and/or vs yesterday, and when it crosses its target CPL (Report targets); again when it's back to normal. Only after a brand has 3+ leads today (adjustable).
- **Update every 30 minutes** — live campaigns / ad sets / ads (total and per brand), today's spend, Meta leads, TeleCRM leads and CPL per brand with change vs 7 days, best and weakest brand today (CPL), brands spending with 0 leads, month best / weakest by CPQL.
- Quiet hours (default 11 pm – 8 am IST) pause updates and CPL alerts; account changes still come through (optional).

Numbers use the dashboard's definitions (Meta leads = lead / chat Results; excluded campaigns' leads left out; repeat TeleCRM leads left out).

**Ad account activity page** (sidebar › Setup, visible only to the alert recipient's login): every Meta ad account change of the last 1 / 7 / 30 / 90 days as a table — When · Who · Brand · Campaign · Ad set / Ad · What changed · Status (before → after) · Remarks: what happens next · Impact (High / Medium / Low) — with filters (brand, person, type, impact, search) and **Check Meta now**. Changes are collected every 5 minutes even without Telegram; the first run also loads the last 7 days.

**Setup (10 minutes):**
1. Telegram › **@BotFather** › `/newbot` › name it (e.g. *EBG Alerts*) › copy the token.
2. Vercel › Settings › Environment Variables › `TELEGRAM_BOT_TOKEN` = token › Save › Redeploy.
3. Supabase › SQL Editor › run `supabase/alerts.sql` once (tables + schedules: changes every 5 min, update at :05 and :35).
4. Hari signs in to the dashboard › Settings › Alerts › **Connect Telegram** › press **START** in the bot chat. The dashboard connects by itself and sends a welcome message.
5. **Send test** / **Send update now** to check.

The Meta token needs access to the ad accounts' activity log (the same System User with *ads_read* works for most accounts; if an account shows "Couldn't read", give the system user that ad account under Assigned assets).

## Google Ads

Header › **Platform: Meta Ads / Google Ads**. The Google view uses the same pages, reports and Excel exports, with:
- **Leads in UI** = Google's *Conversions* column (primary conversions), per campaign per day, all campaign types incl. Performance Max
- **Leads in CRM** = TeleCRM leads whose **UTM Campaign** is that Google campaign's name *or ID* (also picks up leads with Lead Source "Google…", a gclid, or utm_source=google)
- matched at campaign level (Ad sets / Ads pages are hidden); Meta-only parts (budgets, spend check vs Ads Manager, WhatsApp links, Lead leaks) are off
- Google data lives in its own table (`google_ad_rows`), so Meta numbers can never change because of it

### Google Ads setup (one time, ~20 minutes)

1. **Google Cloud project** — console.cloud.google.com › New project (e.g. "EBG Dashboard") › APIs & Services › Library › **Google Ads API** › Enable. On the Google Ads API overview page in the Cloud Console, request access: *Explorer* access works on real accounts straight away (2,880 operations/day — the sync uses about 1 per account per run); *Basic* needs brand verification. (Since Sept 2026 access follows the Cloud project; a developer token is no longer needed.)
2. **OAuth consent screen** — APIs & Services › OAuth consent screen. If EBG uses Google Workspace choose **Internal** (tokens don't expire). Otherwise External, add your email as a user and set Publishing status to **In production** (in *Testing* the token expires after 7 days).
3. **OAuth client** — Credentials › Create credentials › OAuth client ID › *Web application* › Authorised redirect URI `https://developers.google.com/oauthplayground` › Create. Copy the Client ID and Client secret.
4. **Refresh token** — developers.google.com/oauthplayground › ⚙ › tick *Use your own OAuth credentials* › paste Client ID + secret › in Step 1 type the scope `https://www.googleapis.com/auth/adwords` › Authorize APIs › sign in with the Google account that can see the Google Ads accounts (your MCC login) › Step 2 › *Exchange authorization code for tokens* › copy the **Refresh token**.
5. **Vercel** › Project › Settings › Environment Variables (Production, Preview, Development) › add `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, and `GOOGLE_ADS_LOGIN_CUSTOMER_ID` = your manager (MCC) account number, digits only (optional — agency MCCs you can access are found automatically) › Deployments › ⋯ › Redeploy.
6. **Supabase** › SQL Editor › run `supabase/google-ads.sql` once (table, Google-leads view, sync every 30 min at :15/:45).
7. **Dashboard** › Settings › Data connections › *Google Ads* › Load Google Ads accounts › tick accounts, pick brands › turn on Auto-sync › **Sync now**.
8. **UTM tags** — so TeleCRM leads match their campaign, each Google campaign's *Final URL suffix* should carry `utm_source=google&utm_medium=cpc&utm_campaign={campaignid}` (works for every campaign type incl. PMax; the dashboard turns the ID into the campaign name). Campaign names in utm_campaign work too, if typed exactly.

## History (change log)

Sidebar › **History**: who changed what and when, with old → new values, like Meta / Google Ads change history. Filter by person or type, search by brand, campaign or setting.

Recorded by the database (`supabase/change-history.sql`, run once in Supabase › SQL Editor), so nothing can skip it and nobody can edit or delete it:
- every saved settings change: brands, brand rules, QL statuses, report targets per month, leaders, report remarks, Meta ad accounts on/off and brand, WhatsApp/no-campaign links, holidays, column names…
- saved data uploaded or deleted
- team members added, removed or re-roled

Automatic jobs (Meta auto-sync, n8n TeleCRM push) are not logged.

## Lead leaks page

Sidebar › **Lead leaks** › pick a period › **Find leaks**. Three checks, biggest money first:

1. **Form leads that don't reach TeleCRM** — per lead-form campaign: Meta leads vs TeleCRM leads, missing leads, money spent on them (missing × CPL), last day each side got a lead. Flags: *No leads reach TeleCRM* (0 in CRM), *Stopped reaching TeleCRM* (3+ missing and TeleCRM quiet 2+ days while Meta still gets leads), *Only some reach* (20%+ and 3+ missing). Gaps of 1–2 leads are ignored (repeat submissions). Includes the fix steps.
2. **WhatsApp leads without a campaign** — TeleCRM WhatsApp leads per brand that aren't linked to Click-to-WhatsApp campaigns, with a button to Settings › Leads without a campaign.
3. **Ad accounts spending but not synced** — `GET /api/meta?op=coverage` lists every account the Meta token can see with its spend in the period; unsynced spending accounts can be added to the sync in one click (admins/editors).

## Rules
- **Leads in UI** = sum of the Meta Results column. **Leads in CRM** = TeleCRM rows (optional rules in Settings: Meta sources only, report dates only, unique Lead id).
- CRM leads match Meta by Facebook Campaign + Ad Set + Ad name (or at ad set / campaign level when the Meta export has no ad columns). Unmatched leads keep their own rows; nothing is guessed.
- **QL** is decided by status intent: rejection words first (not interested, lost, junk…), then buying-intent words (details shared, interested, site visit, booked…).
- **TAT** = Created On → First Attempted Call, shown in minutes up to 60 and in hours above that (Excel keeps a minutes column for sorting). SLA % = within ÷ (within + delayed + pending).
- **Excluded results:** untick *Count results* on the Campaigns tab when a campaign's Meta results aren't leads. Only its results are left out of Leads in UI; its spend, CTR and CRM leads are still counted, so Amount spent matches Ads Manager. Campaigns whose Meta *Result indicator* isn't a lead (landing page views, link clicks…) are handled this way automatically; tick the box to count them again.
- **CTR** = link clicks ÷ impressions (totals ÷ totals) on every view, the Trends tab and the Excel file. Add the *Impressions* and *Link clicks* columns to the Meta export; without them CTR shows N/A. Exclusions are remembered in the browser and saved with the team report.
- If the Meta export isn't split by day, spend and Leads in UI show **N/A** for date ranges narrower than the export, with a notice.

## Saving data and exporting
- **Save for team** stores the loaded data so everyone on the team opens the same report without uploading anything. The newest team save opens automatically for everyone. Name each save; saving with an existing name replaces it.
- **Saved data › This browser only** keeps a private copy in this browser (IndexedDB), so you don't upload them again. Name each save, open or delete any of them, and optionally open the latest one automatically. Only the report columns are kept; no names, phone numbers or emails.
- **Download Excel** opens export options: all brands or the selected brand, and which sheets to include. The workbook is formatted: title and period line on each sheet, frozen bold header, filters, ₹ / % / count formats, totals, flagged cells, and TAT in minutes plus readable hours.

## Team database (Supabase)
When Supabase is connected, the Vercel site keeps one shared database of every upload:

- **Add this upload to the database** (editors) adds Meta rows (one per ad per day) and TeleCRM leads (one per Lead id). Re-uploading the same days or leads **updates** them: a lead's newest status, owner and first call win. Upload the newest exports last.
- **Open from database** loads any date range; the date picker reloads from the database, so history goes back as far as you've uploaded.
- **Trends** tab: spend, Leads in UI vs CRM, CPL, CPQL, QL rate, TAT and SLA by day, week or month, with CPL / CPQL change vs the previous period.
- **Shared settings**: brand keywords, QL rules and excluded campaigns changed by an editor apply for the whole team.
- **Logins**: each person signs in with their own email and password. Roles: *viewer* (sees data), *editor* (adds uploads, changes shared settings), *admin* (also removes uploads and manages members). People not on the team see nothing, even with an account.
- Stored per lead: lead id, created time, source, campaign / ad set / ad, status, CRM brand, owner, first call time, plus the report brand, QL flag and TAT, and for the CRM leads data tab the lead's name, phone, email and every other TeleCRM column (only signed-in team members can read them).

### Status
Connected to Supabase project `oggmosadlkarwlurxdjk` (tables, row level security, views and the first admin are set up; `api/config.js` points the site at it). To use another project, set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in Vercel.

To rebuild from scratch on a new project: run [`supabase/schema.sql`](supabase/schema.sql) in the SQL Editor, then the *FIRST ADMIN* line with your email. In Authentication › Sign In / Providers › Email, turning off **Confirm email** lets teammates sign in right after creating their account.

### Looker Studio (optional)
Run the *OPTIONAL: read-only login for Looker Studio* block at the end of `schema.sql` (set a password first). In Looker Studio › Add data › **PostgreSQL**: host and port from Supabase › Connect › **Session pooler**, database `postgres`, user `looker_reader.<project-ref>`, your password, tick **Enable SSL**. Use the views `v_brand_daily`, `v_meta_daily`, `v_crm_leads`.

## Hosting
`index.html` is self-contained (SheetJS 0.18.5 and ExcelJS 4.4.0 from cdnjs, fonts from Google Fonts). Team saving uses `api/team.js`, a Vercel function backed by Vercel Blob.

### Switch on team saving in Vercel (one time)
1. Open the project in Vercel › **Storage** › **Create** › **Blob**, name it (e.g. `ebg-team-data`) and **connect it to this project**. This adds `BLOB_READ_WRITE_TOKEN` automatically.
2. Project › **Settings** › **Environment Variables**, add:
   - `TEAM_PASSCODE`: the passcode teammates type to open team data.
   - `TEAM_ADMIN_PASSCODE` (optional): a second passcode needed to save or delete team data. Without it, `TEAM_PASSCODE` can also save.
3. **Deployments** › redeploy the latest deployment.
4. Open the site › **Saved data** › enter the passcode once per browser.

Team data is sent to the browser only through `/api/team` after the passcode is checked; blob URLs are random and never exposed. Each save is gzip-compressed (about 60 KB per 5,000 CRM leads; the limit is 4 MB compressed per save). Change a passcode any time in Vercel and redeploy; teammates are asked for the new one.

On the Claude artifact, team saving uses the page's built-in shared storage instead: editors save, everyone the page is shared with can open.


## Meta Marketing API (direct)

1. In Meta Business Settings › Users › System users, create (or pick) a system user, give it the ad accounts under **Assigned assets**, and **Generate new token** with `ads_read`.
2. In Vercel › Settings › Environment Variables add `META_ACCESS_TOKEN` with that token (optional `META_API_VERSION`, default `v23.0`), save and redeploy.
3. In the dashboard › Lead data upload › **Meta Ads data from: Meta API (direct)** (or Settings), load the ad accounts, set each account's brand and press **Sync now**.

### Auto-sync every 30 minutes (Meta API)

`/api/meta-cron` pulls the chosen range (Settings › Meta API › Auto-sync: yesterday + today, last 3/7/14/30 days, this month, or the dashboard's dates) for the ticked accounts and replaces those days.
Each run refreshes yesterday + today first, then older days in 7-day pieces (as many as fit in ~45 s), continuing where the last run stopped.

Scheduler (recommended): the Supabase database. GitHub's own schedule is often hours late on small repos.
- Supabase › SQL Editor › New query: paste `supabase/meta-autosync-scheduler.sql`, Run. It creates its own key in Vault; nothing to copy.
- Vercel › Environment Variables: `SUPABASE_SERVICE_ROLE_KEY` (Supabase › Project Settings › API keys), then redeploy.
- Dashboard › Settings › Meta API (direct): tick **Auto-sync every 30 minutes** and pick the range.

Backup: `.github/workflows/meta-sync.yml` can also call it (secret `CRON_SECRET` + variable `SITE_URL` in GitHub, `CRON_SECRET` in Vercel), or run it by hand from GitHub › Actions.

### TeleCRM leads via n8n (automatic, every 30 minutes)

n8n reads leads from TeleCRM with its own TeleCRM connection and POSTs them to `/api/crm-push`; nobody needs the TeleCRM token.
- Vercel › Environment Variables: `CRM_PUSH_KEY` (any long random text, 16+ characters) and `SUPABASE_SERVICE_ROLE_KEY`, then redeploy.
- n8n › Import from file: `n8n/telecrm-to-dashboard.json`. In "TeleCRM: latest 500 leads" pick the existing TeleCRM credential and replace `YOUR_ENTERPRISE_ID`; in "Send to dashboard" create a Header Auth credential `x-push-key` = the same `CRM_PUSH_KEY`. Activate.
- Body: a JSON array of leads (or `{ "leads": [...] }`), either export-style columns (Lead id, Created On, Status, Facebook Campaign Name, Facebook Ad Set Name, Facebook Ad, Assignee name, First Attempted Call, Phone, Email, …) or TeleCRM API leads (`{ id, fields }`). Leads are upserted by lead id; values not sent keep what is stored.
- Leads without a Created On stay undated (hidden from date views) unless the call adds `?estimateCreated=1`. The n8n workflow dates a lead the first time it sees it (after its first run). A TeleCRM export upload still fills exact Created On and First Attempted Call (TAT).
- Settings › "TeleCRM via n8n" shows the last push.
