// Backend endpoint for the incident form.
//
// This must point at a Google Apps Script Web App (deployed as "Anyone")
// that writes to the incident sheet. It is SEPARATE from the breakdown
// app's endpoint — do not reuse the breakdown endpoint or incidents will
// land in the breakdown data.
//
// Until the Apps Script is deployed, leave this as the placeholder. The form
// still works end-to-end in the UI; submitting will show a clear message
// instead of posting. Once you deploy the script, paste its /exec URL here.
export const ENDPOINT = "REPLACE_WITH_YOUR_APPS_SCRIPT_EXEC_URL";

export const isEndpointConfigured = () =>
  typeof ENDPOINT === "string" && ENDPOINT.startsWith("https://");
