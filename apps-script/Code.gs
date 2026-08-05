/**
 * ⚠️ DEPRECATED PROTOTYPE — DO NOT DEPLOY.
 * Superseded by incident-api-v2.gs in this folder, which is the real, deployed
 * backend (severity tiering, running case numbers, photo upload, writes to the
 * IncidentsData tab of the "Incident Report Updated" workbook). This file is
 * the original flat-"Submissions" stub, kept only for history; its
 * SPREADSHEET_ID was never configured. See README.md.
 *
 * Northern Logistics — Incident Report backend (Google Apps Script Web App)
 *
 * Receives submissions from the norloworld-incident web app and appends one
 * row per incident to a flat "Submissions" tab. This is SEPARATE from the
 * breakdown backend — use its own spreadsheet (or a new tab), never the
 * breakdown endpoint.
 *
 * The web app sends the body as a JSON string with a text/plain content type,
 * which keeps it a CORS "simple request" (no OPTIONS preflight, which Apps
 * Script does not answer). The route is passed as a query param:
 *   POST <exec-url>?route=createIncident
 *
 * SETUP
 *  1. Create a NEW, dedicated Google Sheet for incident submissions (keep it
 *     separate from the formatted "2026 Incident Report" file). Copy its ID
 *     from the URL into SPREADSHEET_ID below.
 *  2. Deploy → New deployment → Web app.
 *       - Execute as: Me
 *       - Who has access: Anyone
 *  3. Copy the /exec URL into src/config.js (ENDPOINT) in the web app.
 */

// ---- Configuration ---------------------------------------------------------

// The dedicated submissions spreadsheet to write to. Create a new Google Sheet
// and paste its ID here (the long string in its URL between /d/ and /edit).
// Keep this separate from the formatted "2026 Incident Report" file; if you
// want the data visible there too, pull it in with IMPORTRANGE.
var SPREADSHEET_ID = 'PUT_YOUR_NEW_SUBMISSIONS_SHEET_ID_HERE';

// Tab that receives one row per submission. Created automatically if missing.
var SHEET_NAME = 'Submissions';

// Optional shared secret. Leave '' to accept any request (matches the
// breakdown app). If set, the web app must send the same value as `token`.
var SHARED_SECRET = '';

// Field order for the flat sheet. Keys MUST match src/incidentSchema.js.
// `incidentTypes` and a server timestamp are prepended automatically.
var FIELDS = [
  { key: 'driverName',           label: 'Last Name, First Name' },
  { key: 'truckNumber',          label: 'Northern Truck #' },
  { key: 'trailerNumber',        label: 'Northern Trailer #' },
  { key: 'dateOfIncident',       label: 'Date of Incident' },
  { key: 'timeOfIncident',       label: 'Time of Incident' },
  { key: 'intakeMember',         label: 'Incident intake team member / Phone Number' },
  { key: 'location',             label: 'Incident Location' },
  { key: 'driverContact',        label: 'Driver Name and Phone Number' },
  { key: 'reportedCorrectly',    label: 'Reported correctly (Driver line option 6)?' },
  { key: 'driverOk',             label: 'Is driver OK?' },
  { key: 'injuryType',           label: 'Type of injury' },
  { key: 'medicalAttention',     label: 'Medical attention needed? Type?' },
  { key: 'otherPartiesInjured',  label: 'Other parties injured?' },
  { key: 'drugTest',             label: 'Drug test required?' },
  { key: 'deerAnimal',           label: 'Deer / Animal accident?' },
  { key: 'otherPartiesInvolved', label: 'Other parties involved?' },
  { key: 'ticket',               label: 'Ticket? Who received it?' },
  { key: 'fuelOilSpill',         label: 'Fuel / Oil spill?' },
  { key: 'customerContact',      label: 'Customer Name & Contact Number' },
  { key: 'equipmentInvolved',    label: 'Vehicles / Equipment / Property involved' },
  { key: 'towConfirm',           label: 'Tow required?' },
  { key: 'towCompany',           label: 'Tow company / details' },
  { key: 'truckTrailerPics',     label: 'Our truck and trailer pics collected?' },
  { key: 'involvedPics',         label: 'Involved property/equipment pics collected?' },
  { key: 'scenePic',             label: 'Accident scene pic collected?' },
  { key: 'reportCardNumber',     label: 'Accident Report Card / Number' },
  { key: 'videoPulled',          label: 'Has video been pulled?' },
  { key: 'videoProves',          label: 'Does video prove other party at fault?' },
  { key: 'videoSent',            label: 'Was video sent to driver / officer?' },
  { key: 'otherExplain',         label: 'Other (explain)' },
  { key: 'description',          label: 'Brief description of what happened' },
  { key: 'advisedNoContact',     label: 'Advised driver not to contact other people?' },
  { key: 'police',               label: 'Police (identity, post, station, city)' },
  { key: 'officer',              label: 'Officer name and badge #' },
  { key: 'witness1',             label: 'Witness #1' },
  { key: 'witness2',             label: 'Witness #2' },
  { key: 'witness3',             label: 'Witness #3' },
  { key: 'otherContacts',        label: 'Other contacts' },
  { key: 'freightAffected',      label: 'Freight affected?' },
  { key: 'dispatchNotified',     label: 'Dispatch notified?' },
  { key: 'breakdownsNotified',   label: 'Breakdowns notified?' },
  { key: 'coachingDb',           label: 'Submitted to Norlo Coaching Database?' },
  { key: 'notes',                label: 'Notes' }
];

// ---- Web app entry points --------------------------------------------------

function doPost(e) {
  try {
    var route = e && e.parameter ? e.parameter.route : '';
    if (route !== 'createIncident') {
      return json({ result: 'error', message: 'Unknown route: ' + route });
    }

    if (!e.postData || !e.postData.contents) {
      return json({ result: 'error', message: 'Empty request body' });
    }

    var data = JSON.parse(e.postData.contents);

    if (SHARED_SECRET && data.token !== SHARED_SECRET) {
      return json({ result: 'error', message: 'Unauthorized' });
    }

    var row = appendIncident(data);
    return json({ result: 'success', row: row });
  } catch (err) {
    return json({ result: 'error', message: String(err) });
  }
}

function doGet() {
  // Simple health check so you can open the /exec URL in a browser.
  return json({ result: 'ok', service: 'incident-report', fields: FIELDS.length });
}

// ---- Core ------------------------------------------------------------------

function appendIncident(data) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // avoid interleaved appends on concurrent submits
  try {
    var sheet = getSheet();

    var incidentTypes = Array.isArray(data.incidentTypes)
      ? data.incidentTypes.join(', ')
      : (data.incidentTypes || '');

    var values = [new Date(), incidentTypes];
    for (var i = 0; i < FIELDS.length; i++) {
      var v = data[FIELDS[i].key];
      values.push(v === undefined || v === null ? '' : v);
    }

    sheet.appendRow(values);
    return sheet.getLastRow();
  } finally {
    lock.releaseLock();
  }
}

function getSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    var header = ['Timestamp', 'Incident Types'];
    for (var i = 0; i < FIELDS.length; i++) header.push(FIELDS[i].label);
    sheet.appendRow(header);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
