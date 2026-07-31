# Incident Report — Apps Script backend

`Code.gs` is the Google Apps Script Web App that receives form submissions and
appends one row per incident to a flat **Submissions** tab.

## Deploy

1. Create a **new, dedicated** Google Sheet for submissions (keep it separate
   from the "2026 Incident Report" file). Then **Extensions → Apps Script**.
2. Replace the default `Code.gs` with the contents of this folder's `Code.gs`.
3. Set `SPREADSHEET_ID` at the top to the new sheet's ID — the long string in
   its URL between `/d/` and `/edit`. (To surface the data inside the 2026
   report file, use `IMPORTRANGE` there rather than pointing the script at it.)
4. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Authorize when prompted.
5. Copy the **/exec** URL and paste it into `src/config.js` (`ENDPOINT`) in the
   web app, commit, and push. Deploys auto-publish to GitHub Pages.

## Test

- Open the `/exec` URL in a browser — `doGet` returns a small JSON health check.
- Submit the live form. A new row should appear on the **Submissions** tab
  (the header row is created automatically on first write).

## Notes

- **Redeploys:** after editing `Code.gs`, use **Deploy → Manage deployments →
  edit → Version: New version**, or the `/exec` URL keeps serving old code.
- **Columns** are driven by the `FIELDS` array — keep its `key`s in sync with
  `src/incidentSchema.js`. Add a field in both places to capture it.
- **Optional auth:** set `SHARED_SECRET` in `Code.gs` and include a matching
  `token` in the submitted payload (would require a small change in the web
  app's submit code). Left blank by default, matching the breakdown app.
