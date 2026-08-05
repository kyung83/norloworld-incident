# Incident Report — Apps Script (source of truth)

The Google Apps Script for this project lives here, version-controlled with the
app. There's no local build for `.gs`/`.html` — **edit here, then paste into the
Apps Script editor** and deploy. The project is **container-bound to the "2026
Incident Report Updated" workbook** (Extensions → Apps Script from that
workbook); all files below live in that *same* Apps Script project.

## Files

| File | Role |
|---|---|
| **`incident-api-v2.gs`** | The deployed **Web App** the driver form calls. `doGet`/`doPost` on `?route=`; severity tiering, running annual case numbers, `savePhoto` → Drive, writes one row per incident to `IncidentsData`. Its `/exec` URL is in `src/config.js` (`ENDPOINT`). |
| **`incident-workbook-tools.gs`** | Office-side tools **and the shared library**. Owns the config constants (`DATA_TAB`, `UPDATES_TAB`, `TZ`, `SAFETY_EMAIL`), the `🛡 Safety Incident` menu (`onOpen`), the append-only `IncidentUpdates` log, close-and-email, and the shared helpers (`colIndex_`, `setCell_`, `rowObject_`, `rowForCase_`, `updatesForCase_`, `currentUser_`, `escapeHtml_`, `buildIncidentPrintHTML_`, …). |
| **`IncidentDashboard.gs`** | Server side for `Dashboard.html`: `openIncidentDashboard`, `getCaseList`, `getIncident`, `saveIncident`, plus the record print/email (`makeIncidentPdf`, `emailIncidentPdf`). **Reuses** the helpers/constants from `incident-workbook-tools.gs` — it does not redefine them, so the two files are interdependent (don't remove a shared helper without checking here). |
| **`Dashboard.html`** | The dashboard modal UI, opened by `openIncidentDashboard`. |
| **`incident-workbook-tools-SETUP.md`** | Install + daily-use + test steps for the office tools. |
| **`Code.gs`** | ⚠️ **DEPRECATED** original prototype (flat "Submissions" tab). Not deployed, kept for history. |

> **Interdependency:** `incident-workbook-tools.gs` + `IncidentDashboard.gs` +
> `Dashboard.html` are one set — the dashboard reuses the tools' helpers and
> menu. Deleting or renaming a shared helper breaks the dashboard.
>
> **Superseded:** `dashboard-print-email.gs` (in Downloads) defined
> `getIncidentPrintHtml`/`makeIncidentPdf`/`emailIncidentPdf` — now folded into
> `IncidentDashboard.gs`. It is intentionally **not** in this repo; adding it
> would collide (duplicate function definitions).

## Backend (`incident-api-v2.gs`) — deploy / redeploy

1. Paste into the incident Apps Script project (bound to the workbook).
2. Run **`runSelfTest`** — expect all PASS (the four photo headers use an **em
   dash `—`**, not a hyphen).
3. **Deploy → Manage deployments → ✏️ edit existing → New version** — keeps the
   **same `/exec` URL**. Never create a new deployment.

Writes to workbook `1eet9u2Bb9m_8Aj-TFymxAwouK2z-O1AmAwt5KajVu0w`, tab
`IncidentsData`. Photos → Drive **Incident Photos** (folder named by the
wizard's `sessionId`, renamed to the case number at submit).

## Office tools + dashboard — install

Add `incident-workbook-tools.gs`, `IncidentDashboard.gs`, and `Dashboard.html`
as files in the *same* project (Files → +; the `.html` as an **HTML** file named
`Dashboard`). Save, reload the workbook, then **🛡 Safety Incident → Set up tabs
(run once)**. The menu's **Open** item launches the dashboard. Setup + daily use
in `incident-workbook-tools-SETUP.md`.

## Pending

- **FIX 1b (case number stored as text)** is **not yet applied** to
  `incident-api-v2.gs`: after `sheet.appendRow(...)`, force column A to text
  (`sheet.getRange(rowNum, 1).setNumberFormat('@').setValue(caseNumber)`) so
  leading zeros survive (`08042601`, not `8042601`). Needs a backend redeploy.

> These copies are the source of truth. The parallel "Accident reporting system"
> chat edits the loose copies in `Downloads/`; keep this folder synced from
> Downloads until that chat is retired, so the repo doesn't go stale.
