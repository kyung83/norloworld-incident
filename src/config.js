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
export const ENDPOINT = "https://script.google.com/macros/s/AKfycbyrRnLcXa9kaktTSPbDB5FlZYED-VJUWhoRUdP6fCx6kEF5cbxT-i1byVngv8UfIp4e/exec";

export const isEndpointConfigured = () =>
  typeof ENDPOINT === "string" && ENDPOINT.startsWith("https://");
