# Incident Report — Apps Script (source of truth)

The Google Apps Script for this project lives here, version-controlled with the
app. There's no local build for `.gs` — **edit here, then paste into the Apps
Script editor** and deploy. The project is **container-bound to the "2026
Incident Report Updated" workbook** (Extensions → Apps Script from that
workbook), so both files below live in the *same* Apps Script project.

## Files

| File | Role |
|---|---|
| **`incident-api-v2.gs`** | The deployed **Web App** the driver form calls. `doGet`/`doPost` on `?route=`; severity tiering (`computeSeverity_`), running annual case numbers, `savePhoto` → Drive, writes one row per incident to `IncidentsData`. Its `/exec` URL is in `src/config.js` (`ENDPOINT`). |
| **`incident-workbook-tools.gs`** | Office-side tools, a **2nd file in the same project**. Adds the **🛡 Safety Incident** menu (append-only `IncidentUpdates` log, `Queue` view, Close & email PDF). Container-bound, so it captures the real editor email. Reuses `incident-api-v2.gs`'s `rowForCaseNumber_`; see the header comment for the deliberate non-reuse of `colFor_`. |
| **`incident-workbook-tools-SETUP.md`** | Install + daily-use + test steps for the office tools. |
| **`Code.gs`** | ⚠️ **DEPRECATED** original prototype (flat "Submissions" tab). Not deployed, kept for history. Do not use. |

## Backend (`incident-api-v2.gs`) — deploy / redeploy

1. Paste the file into the incident Apps Script project (the one bound to the
   workbook).
2. Run **`runSelfTest`** — expect all PASS (tier logic + sheet + column lookups;
   the four photo headers use an **em dash `—`**, not a hyphen).
3. **Deploy → Manage deployments → ✏️ edit existing → New version** (approve
   re-auth). Editing the existing deployment keeps the **same `/exec` URL** —
   never create a new deployment (it would change the URL in `src/config.js`).

Writes to workbook `1eet9u2Bb9m_8Aj-TFymxAwouK2z-O1AmAwt5KajVu0w`, tab
`IncidentsData`. Photos → Drive folder **Incident Photos** (one subfolder per
incident, named by the wizard's `sessionId` then renamed to the case number at
submit). Flags in the file: `DRY_RUN`, `SMS_ENABLED`, `BREAKDOWN_SPAWN_ENABLED`.

## Office tools (`incident-workbook-tools.gs`) — install

Add it as a **2nd file** in the *same* project (Files → + → Script →
`incident-workbook-tools`), Save, reload the workbook, then run **🛡 Safety
Incident → Set up tabs (run once)**. Full steps in
`incident-workbook-tools-SETUP.md`.

> These copies are the source of truth. The loose copies in `Downloads/` are now
> redundant — edit here and paste from here.
