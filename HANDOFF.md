# norloworld-incident — Project Handoff

A handoff document for continuing work on the Northern Logistics **Incident Report** app in a new session. Read this first.

---

## 1. What this is

A standalone, mobile-first **driver incident-reporting web app**, split off from the older `norloworld-breakdown` app. A driver on a tablet (Eleos webview) reports an incident; the backend tiers it by severity, stores it in a Google Sheet, and (eventually) pages the safety team.

- **Live:** https://kyung83.github.io/norloworld-incident/
- **GitHub repo:** https://github.com/kyung83/norloworld-incident (public, owner `kyung83`)
- **Local repo:** `C:\Users\bfedewa\Documents\norloworld-incident`
- **Stack:** React 18 + Vite + Tailwind, HashRouter, deployed to GitHub Pages via `.github/workflows/deploy.yml` (auto-deploy on push to `main`).
- **Status:** In active testing (uses a test phone number; not yet rolled out to drivers).

---

## 2. Environment constraints (read before running anything)

- **No Node/npm** on PATH in this environment — you cannot `npm install` / `npm run build` / lint locally. **GitHub Actions CI is the build check.** Push and watch the run.
- **git** works.
- **gh CLI** is installed at `C:\Program Files\GitHub CLI\gh.exe` (v2.97.0), authenticated as **kyung83**. It is **not on the Bash tool's PATH**; reach it from the **PowerShell** tool after refreshing PATH:
  ```
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
  ```
- **Deploy loop:** edit → `git commit` → `git push origin main` → GitHub Actions builds + deploys → **CDN lag ~1 min** → hard-refresh (Ctrl+Shift+R) or add a `?cachebust=x` query param to see it.
- **Watch a deploy:** `gh run list --limit 1 --json databaseId --jq '.[0].databaseId'` then `gh run watch <id> --exit-status`.
- **Verify what actually deployed** (bypass CDN cache) by fetching the bundle with `cache: 'no-store'` in the in-app browser: read `/norloworld-incident/index.html?bust=…` → grab the `assets/index-*.js` name → fetch it and grep for expected strings.
- **Jump to any wizard screen** for testing by injecting a draft into `localStorage['norlo-incident-draft-v1']` = `{ values, types, step, sessionId }` then reloading. Clear it with `localStorage.removeItem(...)` when done. (`sessionId` names the photo folder — see patch 11.)

---

## 3. Architecture

### Frontend (this repo)
- **`src/incidentSchema.js`** — single source of truth. `INCIDENT_TYPES`, `CHECKLISTS`, `SECTIONS` (each section has `fields` OR `rows`), `OFFICE_SECTIONS`, `ALL_FIELD_KEYS`. Edit the form here.
- **`src/components/IncidentFormWizard.jsx`** — the driver-facing wizard. **This is the main component.** (`IncidentForm.jsx` is a kept-but-unrendered single-page fallback.)
- **`src/config.js`** — `ENDPOINT` = the Apps Script `/exec` URL.
- `src/App.jsx` routes `/` → `IncidentFormWizard`.

### Wizard behavior
- **Light card** UI (white bg, `text-gray-900`) floating on the dark app shell. Everything must stay readable on white — patches often arrive authored in dark colors; reconcile them.
- **Screen order:** first gate (`anyoneInjured`) → identity → remaining gates → incident types → visible branch sections + the checklist → review. Identity is 2nd so an abandoned form still identifies the driver.
- **Gates** = 14 always-shown severity questions that drive tiering. The first gate shows a banner with **Driver Line: (989) 802-7135** (`tel:+19898027135`) — this dials what it displays; leave it.
- **Incident types:** `accident`, `injury`, `damageOurs`, `damageTheirs`, `tow`, `other`. (Historical: old keys were `vehicleDamage`→`damageOurs`, `propertyDamage`→`damageTheirs`; old sheet rows use old labels.)
- **Checklist section** (`id: "checklist"`, uses `rows` not `fields`): rows render **Yes / No / N-A with reveal-on-answer**:
  - `alwaysRequired` — scene photos, no N/A (a wide shot is always possible).
  - `checklistRow` with `answeredBy` — **locked**, reads a gate (citation/police/otherVehicle), shows "Yes — from your earlier answer" + a **change** link, reveals fields; does not re-ask.
  - `checklistRow` asked — three buttons; `naReasons` list; `naFollowUp` (e.g. hit-and-run plate/description required when "They left the scene"). "Other — I'll explain" requires a ≥15-char note.
  - Row visibility: `showIf` (gate) and `showIfTypes` (incident type).
- **Photo upload** (per-photo state machine): capture → downscale (1600px, JPEG 0.6) → upload to `savePhoto` route → status `uploading|done|failed`. **Retry** reuses the in-memory image (never re-shoot on a blip). 45s abort timeout; one automatic retry before showing manual Retry. Submit disabled while any upload is in flight ("Uploading photos… X of Y"). Photo URLs go in `values`; image data is not persisted to the draft.
- **Review screen:** grouped by section with real labels (never raw keys), Drive URLs shown as "Uploaded" + an "N photos uploaded" banner, per-section **Edit** links (jump back to that screen), quiet "Start over" at the bottom.
- **CallBar** ("Call safety now"): persistent header **above** the content (never adjacent to Submit); **confirm-first** ("Call the safety line? — Your report is saved…"); dials **`tel:+19894297145`** (⚠️ TEMP test number — Brandon's cell).
- Phone + truck/trailer fields use `inputMode: "numeric"` (the tablet keyboard ignored `"tel"` and showed the full keyboard).

### Backend — **Google Apps Script, now in this repo under `apps-script/`**
- Source of truth: **`apps-script/incident-api-v2.gs`** (version-controlled — edit there, paste into the Apps Script editor). The loose `Downloads\incident-api-v2.gs` copy is now redundant. `apps-script/Code.gs` is a **deprecated** early prototype (flat "Submissions" stub, never configured); `incident-api.gs` (v1) is likewise superseded. See `apps-script/README.md`.
- The Apps Script project is **container-bound to the "Incident Report Updated" workbook** (Extensions → Apps Script opens it). It now also holds a **2nd file, `incident-workbook-tools.gs`**, for the office-side sheet tools — see §7.
- Deployed as a Web App; its `/exec` URL is what's in `config.js` `ENDPOINT`. **v2 incl. the photo-folder fix (patch 11) is deployed ✅** — `runSelfTest` 24/24, deployment edited in place (same `/exec`).
- **Routes** (`doPost`): `createIncident`, `acknowledgeIncident`, `editIncident`, `savePhoto`. (`doGet`: `getIncidentForm`, `getIncidents`.)
- Writes to Google Sheet **"Incident Report Updated"** (`SHEET_ID 1eet9u2Bb9m_8Aj-TFymxAwouK2z-O1AmAwt5KajVu0w`), tab **`IncidentsData`**.
- `computeSeverity_` → Tier 1/2/3, with **fail-upward** (blank/Unknown/N/A gate → Tier 1). `laneFor_` → SAFETY / BREAKDOWN / BOTH (reads incidentTypes text for "someone else"; the old `propertyDamage` boolean is gone).
- `savePhoto` → saves to Drive `Incident Photos / "PENDING <sessionId>" / …`, returns the URL. The folder is named by the wizard's per-submission `sessionId` (the case number doesn't exist yet at upload time); `createIncident` renames it to `"<CaseNumber> - Driver"` at submit — see patch 11. Root folder is shared **once** on creation; the file upload happens **outside** the lock so photos upload in parallel.
- **Case number** (`nextCaseNumber_`): `MMDDYY` (of the incident) + a **running sequence that counts per year** (continues across days/months, resets Jan 1). 2-digit minimum, auto-expands (100→3 digits). Uses a header lookup for the "Case Number" column; runs under a `LockService` lock with the append.
- **Columns are header-addressed** (`colFor_` / `setByHeader_`) after the column-reorder patch, so the sheet can be reordered freely. Photos are written **inline** from the payload (our flow has no `savePhotoUrls`).
- `runSelfTest()` validates tier logic + sheet connection + column lookups. Flags: `DRY_RUN: true`, `SMS_ENABLED: false`, `BREAKDOWN_SPAWN: false` (rows land, no phones ring yet).

---

## 4. OUTSTANDING — do these next

1. **Verify the photo-folder fix (backend redeployed ✅).** `incident-api-v2.gs` incl. patch 11 is deployed (`runSelfTest` 24/24, same `/exec`). Remaining is the end-to-end check: delete the old `2026-08-02 Steve-Stinky` test photo folder, then run one clean submit and confirm the new folder is named `MMDDYY## - Driver-Name`. **Two submits from the same test driver on the same day** is the real proof (that was the exact collision).
2. **Real safety phone number(s).** CallBar dials the temp test number `+19894297145`. Replace with the real driver/safety line (option 6, printed on the checklists). If two numbers, turn the single bar into two buttons.
3. **Test 4 (real device):** photo upload failing on one bar of signal → Retry without re-shooting → submit stays disabled while uploading. Only validatable on a real phone; it's the pre-driver gate.
4. **Eleos webview:** confirm `tel:` links actually dial from inside Eleos (it doesn't always behave like a browser).
5. Non-blocking: CI shows a Node 20 deprecation warning (actions run on Node 24). Could bump `actions/*` versions someday.

### The 28-column header row for `IncidentsData` (order = A→AB)
```
Case Number | Timestamp | Driver | Driver Phone | Truck | Trailer | Type | Subcategory | Location | City | State | Description | Tier | Tier Reasons | Lane | Status | Claimed By | Claimed At | Not applicable | Answered no | Photo — Scene | Photo — Our Truck | Photo — Other | Photos — Folder | Office Notes | Breakdown ID | Incident ID | Payload
```
The four photo headers use an **em dash (—)**: `Photo — Scene`, `Photo — Our Truck`, `Photo — Other`, `Photos — Folder`. `runSelfTest`'s column check fails loudly if a hyphen sneaks in.

---

## 5. Key facts, IDs, decisions

- **Form fields were derived from** the Google Sheet **"2026 Incident Report"** (Drive fileId `1AzpuRYag_ixLhY_BRCz6vZkLbGcu2sqSnf0Ea8oYD1k`, owner `rramsey@norloworld.com`) — a 126-block repeating template.
- **Submissions sheet** ("Incident Report Updated"): `1eet9u2Bb9m_8Aj-TFymxAwouK2z-O1AmAwt5KajVu0w`, tab `IncidentsData`.
- **Photos** live in Drive folder **"Incident Photos"** in the deploying account's My Drive, one subfolder per incident. Confirm the folder's link-sharing lets Riley/Mark open the URLs.
- **Two separate sheet columns by design:** "Not applicable" (item — N/A reason) vs "Answered no" (rows answered No) — so the office can distinguish *couldn't get it* from *nothing to photograph* from *skipped it*.
- **Case number is a running annual counter** on purpose: the last number of the year = that year's incident count, while the `MMDDYY` prefix still stamps each one with its date.
- Backend `DRY_RUN`/`SMS` stay off until Riley + Mark sign off on the tier definitions.

---

## 6. Patches applied this session (chronological, all frontend unless noted)

1. Severity **gates** section + office-only fields split into `OFFICE_SECTIONS`.
2. **Mobile wizard** (`IncidentFormWizard`) replaces the single-page form; structured address; photo capture; `config.js` endpoint wired.
3. **Damage split** — `vehicleDamage`/`propertyDamage` → `damageOurs`/`damageTheirs`; conditional sections; `witnesses` replaces `contacts`.
4. **Photos → Drive** (savePhoto route + folder + URL columns) — *backend, pending deploy*.
5. **Case number** (annual running) — *backend, pending deploy*.
6. **Checklist-rows engine** (Yes/No/N-A, reveal-on-answer, locked rows, per-photo upload+retry) — supersedes earlier `mandatory-checklist` + `na-handling` patches (do NOT apply those). Backend gained `Not applicable`/`Answered no` columns + N/A tier reason — *backend, pending deploy*.
7. **Numeric keypad** for truck/trailer/phone fields.
8. **Upload smoothness** — folder shared once (not per photo), upload outside the lock, 45s timeout, one auto-retry, JPEG 0.6 — *backend perf part pending deploy*.
9. **Column reorder + header lookups** — Case Number → col A, `colFor_`/`setByHeader_`, self-test column check; photos kept inline (our flow) — *backend, pending deploy*.
10. **Review screen + call bar** — grouped/labeled review, call bar moved above content, confirm-first, dials `+19894297145`.
11. **Photo folder collision fix** — a driver with two incidents on one day no longer lands both photo sets in the same folder. The wizard mints one `sessionId` per submission (persisted in the draft, restored via `setSessionId`, threaded through a `sessionIdRef` so the upload callback never uses a stale ID), sends it with every `savePhoto` and in the `createIncident` payload. Backend: `incidentPhotoFolder_(sessionId, dateStr, driver)` names the upload folder `PENDING <id>`; `incidentPhotoFolderFinal_(p, caseNumber)` renames it to `"<CaseNumber> - Driver"` inside the lock right after `nextCaseNumber_` (legacy date+driver fallback kept for an old cached front end). **Frontend deployed (commit `b2dd251`); backend deployed ✅.** Abandoned forms leave `PENDING S…` folders on purpose (evidence survives) — worth a monthly glance or an eventual >30-day cleanup.
12. **CallBar → bottom + wording** — moved from above the question content to the bottom of every screen (below Back/Next + the "Saved" line); "Call safety now" → "Call safety", confirm heading → "Call safety?". The amber first-gate driver-line banner is untouched. Commit `f2b3003`.
13. **No gate auto-advance** — picking a gate answer records + highlights it; the driver taps Next themselves (avoids accidental progression from a mis-tap). All 14 gates. Commit `f2b3003`.
14. **Photo upload reliability** — client-side concurrency limiter (`makeLimiter`, cap `UPLOAD_CONCURRENCY = 3`), per-photo timeout 45s→60s, 2 auto-retries with backoff (was 1). Fixes the tail of ~10 photos failing on one bar of cell signal; each active upload gets more bandwidth. Image quality left unchanged (evidence). If the tail still fails, drop concurrency 3→2. Commit `7bd53c1`.
15. **Apps Script source into the repo** — `apps-script/` now holds `incident-api-v2.gs` + `incident-workbook-tools.gs` (+ its SETUP); `Code.gs` marked deprecated; `apps-script/README.md` rewritten for the real backend. Session log at `docs/session-2026-08-05.md`.

> Note: several patches arrive from a **parallel "Accident reporting system" chat** and are sometimes written against a slightly different codebase (dark theme, or a `savePhotoUrls` backend flow we don't have). Always reconcile to *this* repo's actual state before applying, and flag divergences.

---

## 7. Office-side dashboard — sheet-native (NEW this session)

Riley/Mark/Spencer work incidents **inside the "Incident Report Updated" workbook**, not a separate web app. Decided 2026-08-04: go sheet-native first (zero real incidents yet; don't over-build). A React dashboard (a **new** repo) is deferred until ~20 real incidents show what's actually wanted. What a web app would add later: click-to-call (impossible in a sheet — no `tel:` links), enforced append-only, photo thumbnails in the grid.

Delivered as paste-in files in `Downloads` (**installed ✅ — added as the 2nd file, saved, and "Set up tabs" run; `IncidentUpdates` + `Queue` + the Closed columns populated cleanly. Log update / Close & email not yet exercised against a test incident**):
- **`incident-workbook-tools.gs`** — office tools **and the shared library** for the project. Owns the config constants + the `🛡 Safety Incident` menu (`onOpen`) + the append-only log + close-and-email + the shared helpers (`colIndex_`, `setCell_`, `rowObject_`, **`rowForCase_`**, `updatesForCase_`, `currentUser_`, `escapeHtml_`, `buildIncidentPrintHTML_`). Does **not** reuse `incident-api.gs`'s `colFor_`/`setByHeader_` (its `_headerCache` isn't sheet-keyed → wrong columns on multi-tab reads). `incident-api.gs` has no `onOpen`/`onEdit`, so the triggers here are the only ones.
- **`IncidentDashboard.gs` + `Dashboard.html`** — the office **Dashboard** (a modal: case list, per-incident detail with the read-only "everything the driver answered" block, office-field editing, PDF print/email). `IncidentDashboard.gs` is the server side and **reuses** the helpers/constants above — it and `incident-workbook-tools.gs` are **one interdependent set**. The menu's **Open** item launches it. `dashboard-print-email.gs` (Downloads) is **superseded** by functions now inside `IncidentDashboard.gs` — do not add it (it would collide).
- **`incident-workbook-tools-SETUP.md`** — install + daily use + test checklist.
- All of the above are now version-controlled in **`apps-script/`** (source of truth). ⚠️ The parallel "Accident reporting system" chat edits the loose `Downloads/` copies, so keep `apps-script/` synced from Downloads until that chat is retired.
- **FIX 1b applied** to `incident-api-v2.gs` (column A forced to text after `appendRow`, so `08042601` stops becoming `8042601`) — **pending backend redeploy**. Also do FIX 1a by hand once: `IncidentsData` column A → Format → Number → Plain text, then retype the existing damaged case number with its leading zero.

Adds a **🛡 Safety Incident** menu:
- **Set up tabs (run once)** — creates an append-only **`IncidentUpdates`** tab, a live **`Queue`** QUERY tab (open incidents, Tier 1 first, then newest), and **Closed By / Closed At / Closing Summary** columns on `IncidentsData`.
- **Log update** — append-only entry (category dropdown + text + optional link), auto-stamped with the **real editor email** via `Session.getActiveUser().getEmail()` (works because it's container-bound + everyone's `@norloworld.com` — honest identity the web-app deployment couldn't give).
- **Close & email** — required closing summary → builds a PDF of the record + full update log → emails `safety@norloworld.com` → files the PDF to the incident's Drive folder → sets Status = Closed. Replaces the manual File → Email → PDF ritual.

The `Queue` QUERY uses **column letters** (`A`=Case Number, `M`=Tier, `P`=Status …) — correct for the current 28-col A→AB order; if columns are reordered, update that formula (the menu actions are header-addressed and reorder-safe).

**⚠️ Divergence flagged:** `kyung83/norloworld-dashboard`'s repo description says "incidents table with filters," but its actual code (main branch) is the **live Coaching / CSA-violations dashboard** on a *different* Apps Script endpoint. Do **not** build incident features into it. A future incident web app should be its own new repo pointed at the incident `/exec`.
