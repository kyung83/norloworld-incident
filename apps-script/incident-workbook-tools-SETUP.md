# Safety Incident — office tools (sheet-native)

Paste-and-run tools that live **inside the "2026 Incident Report Updated" workbook**.
No web app, no GitHub, no deploy. Replaces the manual
File → Email → PDF → safety@ ritual with one menu click.

## What you get
- **`IncidentUpdates` tab** — append-only log, one row per update. Never edited.
- **`Queue` tab** — live view of everything not Closed, Tier 1 first, then newest.
- **`🛡 Safety Incident` menu** — Log update, Close & email, and one-time Setup.
- Three columns added to `IncidentsData`: **Closed By, Closed At, Closing Summary**.

## Install (once, ~2 min)
1. Open the **2026 Incident Report Updated** workbook.
2. **Extensions → Apps Script**. This opens the incident project — the one that
   already contains **`incident-api.gs`** (the driver web app). This new file
   goes **into that same project**, as a second file. Do NOT create a new
   project, and do NOT touch `incident-api.gs`.
3. In the editor's **Files** list, click the **+ → Script**, name it
   **`incident-workbook-tools`**, and paste **all** of
   `incident-workbook-tools.gs` into it. Click **Save** 💾.
4. Reload the workbook tab. A **🛡 Safety Incident** menu appears.
5. Run **🛡 Safety Incident → Set up tabs (run once)**. Approve the permission
   prompt (it needs Sheets + Drive + Gmail to file and email the PDF). Done.

> First run asks you to authorize the added Drive/Gmail permissions. This does
> **not** require redeploying the web app — the driver form's `/exec` keeps
> working. The tools run as **you**, so emails send from your account and the
> "Added by" field is your real address — no spoofable dropdown.

> Safe to add: this file defines no function that already exists in
> `incident-api.gs`. It reuses that file's `rowForCaseNumber_` and adds only new
> names (menu handlers, `onOpen`/`onEdit`, and `…_` helpers), so nothing the
> driver form relies on changes.

## Daily use
- **Log an update:** click any cell in the incident's row (Queue or
  IncidentsData) → **🛡 → Log update** → pick a category, type it, Save. It's a
  new row, stamped with your email + timestamp. Nothing is overwritten.
- **Close an incident:** click any cell in its row → **🛡 → Close & email** →
  type the required closing summary → **Build PDF, email & close**. That PDF
  (full record + every log entry + your summary) goes to safety@norloworld.com,
  gets filed to the incident's Drive photo folder, and the row flips to Closed
  (dropping off the Queue).

A closed incident can still receive log entries — a court date months later is
just another row. Re-run Close to regenerate the PDF if needed.

## Notes / limits (sheet-native)
- **Click-to-call** the driver isn't possible from a Google Sheet (no `tel:`
  links). The phone number shows as text. This is the main thing a web app
  would add later, along with enforced append-only protection and photo
  thumbnails in the grid.
- Photo **embedding** in the PDF needs the Drive photo folder shared with you.
  If a photo can't be fetched it falls back to a clickable link.
- The `Queue` tab is a live formula — don't type into it; work from it or from
  `IncidentsData`.
- Append-only is a discipline, not a hard lock, in the sheet. The log dialog and
  the onEdit stamper make the right path the easy path; add protected ranges
  later if you want it enforced.

## Test checklist
1. Run Setup → confirm `IncidentUpdates` + `Queue` tabs and the 3 new columns.
2. Log an update against a test incident → confirm a stamped row appears.
3. Close a test incident → confirm the email lands at safety@, the PDF is in the
   Drive folder, and the row shows Closed / your email / timestamp / summary.
