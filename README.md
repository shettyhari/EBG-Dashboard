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
- Stored per lead: lead id, created time, source, campaign / ad set / ad, status, CRM brand, owner, first call time, plus the report brand, QL flag and TAT. **No names, phone numbers or emails.**

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


## Windsor.ai (Meta Ads data without downloading reports)

1. In Windsor.ai, connect your Meta (Facebook) ad accounts and copy your API key (Windsor.ai › Settings › API key).
2. In Vercel › this project › Settings › Environment Variables, add `WINDSOR_API_KEY` with that key (Production), save, then redeploy.
3. In the dashboard › Settings › Windsor.ai, load the ad accounts, tick the ones to sync, pick each account's brand, and press **Sync now**.

The key stays in Vercel; `api/windsor.js` checks that the caller is signed in and on the team (admins and editors can sync).
Each sync replaces the stored Meta data for the same campaigns and days, and shows up in Saved data as an upload with one file per account.

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
