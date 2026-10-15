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

## Rules
- **Leads in UI** = sum of the Meta Results column. **Leads in CRM** = TeleCRM rows (optional rules in Settings: Meta sources only, report dates only, unique Lead id).
- CRM leads match Meta by Facebook Campaign + Ad Set + Ad name (or at ad set / campaign level when the Meta export has no ad columns). Unmatched leads keep their own rows; nothing is guessed.
- **QL** is decided by status intent: rejection words first (not interested, lost, junk…), then buying-intent words (details shared, interested, site visit, booked…).
- **TAT** = Created On → First Attempted Call, shown in minutes up to 60 and in hours above that (Excel keeps a minutes column for sorting). SLA % = within ÷ (within + delayed + pending).
- **Excluded campaigns:** untick a campaign on the Campaigns tab to leave its spend, Meta results and CRM leads out of every total. Campaigns whose Meta *Result indicator* isn't a lead (landing page views, link clicks…) are excluded automatically; use *Include again* to count one anyway. Exclusions are remembered in the browser and saved with the team report.
- If the Meta export isn't split by day, spend and Leads in UI show **N/A** for date ranges narrower than the export, with a notice.

## Saving data and exporting
- **Save for team** stores the loaded data so everyone on the team opens the same report without uploading anything. The newest team save opens automatically for everyone. Name each save; saving with an existing name replaces it.
- **Saved data › This browser only** keeps a private copy in this browser (IndexedDB), so you don't upload them again. Name each save, open or delete any of them, and optionally open the latest one automatically. Only the report columns are kept; no names, phone numbers or emails.
- **Download Excel** opens export options: all brands or the selected brand, and which sheets to include. The workbook is formatted: title and period line on each sheet, frozen bold header, filters, ₹ / % / count formats, totals, flagged cells, and TAT in minutes plus readable hours.

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
