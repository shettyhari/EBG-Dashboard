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
- **TAT** = Created On → First Attempted Call. SLA % = within ÷ (within + delayed + pending).
- If the Meta export isn't split by day, spend and Leads in UI show **N/A** for date ranges narrower than the export, with a notice.

## Hosting
`index.html` is self-contained (it loads SheetJS 0.18.5 from cdnjs and fonts from Google Fonts). It works from GitHub Pages or any static host. **Download Excel** saves every view to an .xlsx file. The *Save for team* button only appears when the page runs as a Claude artifact.
