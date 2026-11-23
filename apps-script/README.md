# Apps Script — operations notes (NOT the source of truth)

> ## ⚠️ The code is not in this repo. Do not paste anything from here into Apps Script.
>
> The live server-side code lives **only** in Google Apps Script. This folder
> used to hold copies of it, and those copies drifted badly — the mirror of the
> backend was **1,648 lines against 2,170 live**, missing the breakdown/SMS
> work, the notification-ordering fix, and the lane/shop-repair changes.
> An earlier version of this file told the reader to "edit here and paste over"
> the live file, which would have silently rolled all of that back.
>
> The copies were deleted on 2026-11-23. They remain in this repo's git history
> if you ever need to read what they said, but they are **not** a base to work
> from. Use the Apps Script editor, and use **Project History** inside it for
> past versions.

## Where the code actually lives

Two Apps Script projects, both reachable from <https://script.google.com/home>:

| Project | Contains | Role |
|---|---|---|
| **Norlo Incident API** | `incident-api.gs`, `incident-workbook-tools.gs`, `IncidentDashboard.gs`, `Dashboard.html` | The web app the driver form posts to, plus the office-side sheet tools and dashboard. Also reachable via **Extensions → Apps Script** from the incident workbook. |
| **Norlo Incident SMS** | `norlo-twilio-incident.gs` | Twilio SMS notification and inbound-reply handling. Separate project, separate deployment, separate script properties. |

The frontend in this repo (`src/`) is the only part that is genuinely
version-controlled here. Its `/exec` endpoint is in `src/config.js`.

## Two things that will bite you

**1. Triggers and `doPost` do not run the same code.**
Time-driven and sheet triggers execute the latest **saved** code. `doPost` —
every driver submission — executes the latest **deployed version**. Saving
without deploying leaves the web app on old code while triggers run the new
code, and the two can disagree for months without anyone noticing. After any
edit: **Deploy → Manage deployments → ✏️ edit the existing deployment → New
version**. Never create a second deployment; that changes the `/exec` URL and
the driver form stops reaching the backend.

**2. The dashboard files are one interdependent set.**
`IncidentDashboard.gs` and `Dashboard.html` reuse helpers and config constants
defined in `incident-workbook-tools.gs` (`colIndex_`, `setCell_`, `rowObject_`,
`rowForCase_`, `currentUser_`, `escapeHtml_`, `buildIncidentPrintHTML_`,
`DATA_TAB`, `UPDATES_TAB`, `TZ`, `SAFETY_EMAIL`, …) rather than redefining
them. Removing or renaming a shared helper breaks the dashboard without
breaking the thing you were editing.

## Deploy checklist

1. Edit in the Apps Script editor. Save.
2. Run **`runSelfTest`** — expect all PASS. (The four photo headers use an
   **em dash `—`**, not a hyphen; a hyphen fails the test.)
3. **Deploy → Manage deployments → edit existing → New version.**
4. Confirm the new version is the one serving: the deployment dialog should
   show the version number you just created, not an older one.

## Other files here

- **`incident-workbook-tools-SETUP.md`** — historical. It documents the
  one-time install of the office tools, which is **already done**; its
  paste-the-file step no longer applies. Its *Daily use* section (log an
  update, close & email) is still accurate and worth reading.

## Data locations

- Workbook: **Incident Report Updated** — tabs `IncidentsData`, `Claim Log`,
  `SMS Log`, `IncidentUpdates`, `Queue`, `Roster`.
- Photos: Drive folder **Incident Photos**, one subfolder per incident, named
  `PENDING <sessionId>` during upload and renamed to the case number at submit.
- Case numbers: `MMDDYY` + a per-year sequence, derived from `IncidentsData` at
  submit time. There is **no stored counter** — clearing the sheet resets the
  sequence.
