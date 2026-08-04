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
- **Jump to any wizard screen** for testing by injecting a draft into `localStorage['norlo-incident-draft-v1']` = `{ values, types, step }` then reloading. Clear it with `localStorage.removeItem(...)` when done.

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

### Backend — **Google Apps Script, NOT in this repo**
- Working copy: **`C:\Users\bfedewa\Downloads\incident-api-v2.gs`** (paste this into the Apps Script editor). `incident-api.gs` is the older v1 — superseded.
- Deployed as a Web App; its `/exec` URL is what's in `config.js` `ENDPOINT`.
- **Routes** (`doPost`): `createIncident`, `acknowledgeIncident`, `editIncident`, `savePhoto`. (`doGet`: `getIncidentForm`, `getIncidents`.)
- Writes to Google Sheet **"Incident Report Updated"** (`SHEET_ID 1eet9u2Bb9m_8Aj-TFymxAwouK2z-O1AmAwt5KajVu0w`), tab **`IncidentsData`**.
- `computeSeverity_` → Tier 1/2/3, with **fail-upward** (blank/Unknown/N/A gate → Tier 1). `laneFor_` → SAFETY / BREAKDOWN / BOTH (reads incidentTypes text for "someone else"; the old `propertyDamage` boolean is gone).
- `savePhoto` → saves to Drive `Incident Photos / "YYYY-MM-DD DriverName" / …`, returns the URL. Folder is shared **once** on creation; the file upload happens **outside** the lock so photos upload in parallel.
- **Case number** (`nextCaseNumber_`): `MMDDYY` (of the incident) + a **running sequence that counts per year** (continues across days/months, resets Jan 1). 2-digit minimum, auto-expands (100→3 digits). Uses a header lookup for the "Case Number" column; runs under a `LockService` lock with the append.
- **Columns are header-addressed** (`colFor_` / `setByHeader_`) after the column-reorder patch, so the sheet can be reordered freely. Photos are written **inline** from the payload (our flow has no `savePhotoUrls`).
- `runSelfTest()` validates tier logic + sheet connection + column lookups. Flags: `DRY_RUN: true`, `SMS_ENABLED: false`, `BREAKDOWN_SPAWN: false` (rows land, no phones ring yet).

---

## 4. OUTSTANDING — do these next

1. **Deploy the backend (biggest item).** All backend work is in `Downloads\incident-api-v2.gs` but **not yet deployed**. Steps:
   - Paste it into the incident Apps Script project.
   - Set row 1 of `IncidentsData` to the **28-column header row** below (⚠️ **em dashes** in the four photo headers, not hyphens).
   - Delete the old test rows (they won't match the new order). Hide columns **AA** and **AB**.
   - Run **`runSelfTest`** — expect tier PASSes + a "Column lookups" section all PASS.
   - **Deploy → Manage deployments → ✏️ (edit existing) → New version** (approve the Drive re-authorization). Editing the existing deployment keeps the same `/exec` URL — do **not** create a new deployment.
   - Submit one real test and confirm every value lands in the right column.
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

> Note: several patches arrive from a **parallel "Accident reporting system" chat** and are sometimes written against a slightly different codebase (dark theme, or a `savePhotoUrls` backend flow we don't have). Always reconcile to *this* repo's actual state before applying, and flag divergences.
