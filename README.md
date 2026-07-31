# Northern Logistics — Incident Report

A standalone incident-reporting web app (React + Vite + Tailwind), built from
the breakdown app's structure. The form branches like an org chart: pick one or
more **Incident Types** and only the relevant sections appear. Fields are
derived from the "2026 Incident Report" sheet.

This app is **independent** of the breakdown app — its own repo, its own
deployment, and its own backend.

## Local development

```bash
npm install
npm run dev      # local dev server
npm run build    # production build to dist/
npm run preview  # preview the production build
```

## Where the form lives

- `src/incidentSchema.js` — the single source of truth: incident types,
  sections, fields, and which types reveal each section. Edit this to change
  the form.
- `src/components/IncidentForm.jsx` — form state, branching, validation, submit.
- `src/config.js` — the backend endpoint (see below).

## Backend setup (required before submissions work)

The form posts JSON to a **Google Apps Script Web App** that writes to the
incident sheet. This is separate from the breakdown backend — do not reuse the
breakdown endpoint.

1. Create/choose a Google Sheet for incident submissions.
2. Extensions → Apps Script. Add a `doPost(e)` that:
   - parses `JSON.parse(e.postData.contents)`,
   - handles `e.parameter.route === "createIncident"`,
   - appends the fields to the sheet,
   - returns `ContentService.createTextOutput(...)`.
3. Deploy → New deployment → **Web app**, execute as you, access **Anyone**.
4. Copy the `/exec` URL into `ENDPOINT` in `src/config.js`.

### Payload shape

```jsonc
{
  "incidentTypes": ["Accident (Moving vehicles)", "Injury"],
  "driverName": "...",
  "truckNumber": "...",
  "trailerNumber": "...",
  "dateOfIncident": "2026-07-31",
  // ...every other field key from src/incidentSchema.js (ALL_FIELD_KEYS)
}
```

The body is sent as a JSON **string** (text/plain) on purpose: it keeps the
request a CORS "simple request" and avoids the preflight that Apps Script does
not answer.

## Deployment (GitHub Pages)

1. Create a new GitHub repo named `norloworld-incident` and push `main`
   (see the commands the assistant provided).
2. In `package.json`, set `homepage` to
   `https://<your-username>.github.io/norloworld-incident`.
3. In repo Settings → Pages, set the source to the **gh-pages** branch.
4. Every push to `main` runs `.github/workflows/deploy.yml`, which builds and
   publishes to GitHub Pages.

## Notes / known simplifications

- Driver / Truck / Trailer are free-text inputs. They can be upgraded to
  comboboxes backed by the fleet list (as in the breakdown app) once the
  backend serves those lists.
- The sheet's per-row "Comments/Notations" column is represented by the
  per-section fields and the Notes field, not a note box on every field.
- Photos are referenced via the "collected?" checks and the Driver Incident
  Checklist links, not uploaded. File upload can be added later.
