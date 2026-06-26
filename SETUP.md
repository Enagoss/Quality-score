# TNF QC Scoring — setup

Three things: a **dashboard** (data entry), a **backend** (one shared sheet), and your **BI** (read-only on that sheet).

```
  team members                 Google Apps Script              your BI
  ┌───────────────┐  POST/GET  ┌──────────────────┐  reads     ┌──────────┐
  │ dashboard.html │ ─────────▶ │ Code.gs → Sheet   │ ─────────▶ │ Qlik /   │
  │ (GitHub Pages) │            │ (QC_Scores tab)   │            │ Power BI │
  └───────────────┘            └──────────────────┘            └──────────┘
```

## 1. Backend (one-time, ~5 min)
1. New Google Sheet → **Extensions ▸ Apps Script**.
2. Paste `Code.gs`, run **`setup`** once, approve the prompt. A `QC_Scores` tab appears with all headers.
3. **Deploy ▸ New deployment ▸ Web app** — *Execute as: Me*, *Who has access: Anyone*. Copy the URL.

## 2. Dashboard
- Open `tnf_qc_dashboard.html`, paste the Web app URL into `CONFIG.ENDPOINT`.
- Drop it in your `enagoss` repo (e.g. `expertmatch/qc_dashboard.html`) → it's live on GitHub Pages.
- Until you paste a URL it runs in **local demo mode** (data stays in that one browser, useful for testing). Badge top-right shows live vs local.

## 3. BI
- Connect Qlik / Power BI to the same Google Sheet. The QC %, PM check %, errors, and per-stage flags are all columns already.

## How entries work
- Enter an **ASN code** → **Load** (pulls existing) or **New**. Set **Review type**, **Created on**, and **Delivery deadline**.
- Pick the **stage tab** (PM Raise / QT Match / QC Check / PM CheckFL). Only that stage's checks show, colour-coded (yellow = PM, green = QC). Score each **0 / 1 / 2**.
- **Save this stage** merges just those fields into the ASN's single row. The ✓ marks completed stages. Another team can open the same ASN later and fill their stage without touching yours.

## Things you'll likely want to adjust (top of the HTML)
- **`STAGES`** — which checks belong to which step. I made a best guess; move fields between stages to match your real flow.
- **`CONFIG.MAX_SCORE`** = 2. Each check is scored **0 (good) / 1 (minor) / 2 (bad)**. Percentages are re-based on this: max points per side = (#fields × 2), so PM is out of 6 and QC out of 12. Set `PM_MAX_POINTS` / `QC_MAX_POINTS` if your rubric weights differ. Change `MAX_SCORE` in `Code.gs` too if you change it here.
- **`CONFIG.ALERT_URGENT_DAYS` / `ALERT_SOON_DAYS`** (2 / 5) — when an incomplete assignment turns red vs amber on the Deadlines page.
- Keep the **column names** in `FIELDS[].col` identical to your sheet so BI keeps working. If you edit them, change `HEADERS` in `Code.gs` to match.

## The three pages
- **Entry** — score each check 0/1/2; set Created On + Delivery Deadline at raise. If a deadline is near and stages are still open, a banner warns you what's missing.
- **Scorecard** — paste ASN codes or upload a CSV/text file (first column = code), get QC % and PM % per assignment, export. Leave blank to score everything.
- **Deadlines** — assignments sorted by urgency. Anything incomplete and overdue/≤2 days = red, ≤5 days = amber. Shows the missing stages and a **Fill now** button that jumps to Entry with that ASN loaded. The nav badge counts what needs attention. A complete assignment never alerts.

## Notes
- Concurrency is handled (`LockService`) so two saves to the same ASN can't clobber each other.
- The Web app URL is the only credential, and it only ever writes to this one sheet — no GitHub token exposed, unlike the commit-to-CSV approach.
