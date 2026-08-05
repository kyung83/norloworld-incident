/**
 * =============================================================================
 * IncidentDashboard.gs  —  server side for Dashboard.html
 * =============================================================================
 *
 * Add as a THIRD file in the Norlo Incident API project, alongside
 * incident-api.gs and incident-workbook-tools.gs.
 *
 * NO COLLISIONS. This file deliberately defines only four new top-level names:
 *
 *   openIncidentDashboard   getCaseList   getIncident   saveIncident
 *
 * plus two constants prefixed DASH_. Everything else — headerMap_, colIndex_,
 * ensureColumn_, setCell_, rowObject_, rowForCase_, updatesForCase_,
 * currentUser_, escapeHtml_, DATA_TAB, UPDATES_TAB, TZ — is REUSED from
 * incident-workbook-tools.gs rather than redefined.
 *
 * It does NOT define onOpen. See the note at the bottom for the one line to add
 * to the existing menu.
 *
 * =============================================================================
 */


// -----------------------------------------------------------------------------
// What the driver said, versus what the office adds
//
// Locked fields are the driver's submission and the computed tiering. They are
// read-only on purpose: what a driver reported at the scene is evidence, and if
// he got something wrong that belongs in the update log, not overwritten on top
// of the original. Tier and Tier Reasons are locked for the same reason —
// editing them would make the record disagree with the logic that produced it.
// -----------------------------------------------------------------------------

var DASH_LOCKED = [
  'Case Number', 'Timestamp', 'Driver', 'Driver Phone', 'Truck', 'Trailer',
  'Type', 'Location', 'City', 'State', 'Description',
  'Tier', 'Tier Reasons', 'Lane', 'Not applicable', 'Answered no',
  'Incident ID'
];

// Never rendered. Payload is the full JSON dump of every answer — useful to
// keep, useless to look at, and it would swamp the form.
var DASH_HIDDEN = ['Payload'];

// Multi-line inputs.
var DASH_TEXTAREAS = [
  'Description', 'Tier Reasons', 'Office Notes', 'Closing Summary',
  'Not applicable', 'Answered no', 'Investigation Notes'
];

// Office-side columns. Created on first dashboard open if they do not exist,
// so safety can start recording these without anyone editing the sheet by hand.
// These are the seven pulled out of the driver form plus the drug test, which
// belongs to safety rather than the driver.
var DASH_OFFICE_COLUMNS = [
  // --- intake, from the old workbook's top block ---
  'Intake Team Member',
  'Reported Correctly (option 6)',
  'Advised Driver Not To Contact',

  // --- what safety learns AFTERWARDS -------------------------------------
  // The driver's answers are locked because they are his account of the
  // scene. But a crash report number arrives a week later, an officer's name
  // gets confirmed by phone, a witness comes forward, an insurer finally
  // calls back. In the old workbook safety just typed those into the same
  // cell. Here they get their own fields, so the record shows both what the
  // driver said AND what turned out to be true — which is the more useful
  // pair when someone reads this a year from now.
  'Police Report Number',
  'Police Agency',
  'Officer Name and Badge',
  'Other Party Name',
  'Other Party Phone',
  'Other Party Insurance',
  'Witness Details',

  // --- injury and testing ---
  'Drug Test Required',
  'Drug Test Result',
  'Injury Follow-up',

  // --- video ---
  'Video Pulled',
  'Video Proves Other Party At Fault',
  'Video Sent To Driver/Officer',

  // --- disposition ---
  'Claim Number',
  'Estimated Cost',
  'Preventable',
  'Submitted To Coaching Database',
  'Investigation Notes'
];


// =============================================================================
// OPEN
// =============================================================================

function openIncidentDashboard() {
  ensureDashboardColumns_();
  var html = HtmlService.createHtmlOutputFromFile('Dashboard')
    .setWidth(1400)
    .setHeight(900);
  SpreadsheetApp.getUi().showModalDialog(html, 'Incident Dashboard');
}

/** Adds the office columns once, at the end, if they are missing. */
function ensureDashboardColumns_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(DATA_TAB);
  if (!sheet) throw new Error('No tab named ' + DATA_TAB);
  DASH_OFFICE_COLUMNS.forEach(function (h) { ensureColumn_(sheet, h); });
}


// =============================================================================
// LIST
// =============================================================================

/** Everything, newest first. The dashboard filters client-side. */
function getCaseList() {
  var sheet = SpreadsheetApp.getActive().getSheetByName(DATA_TAB);
  if (!sheet || sheet.getLastRow() < 2) return [];

  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var rows    = sheet.getRange(2, 1, sheet.getLastRow() - 1, lastCol).getValues();

  function idx(name) {
    for (var i = 0; i < headers.length; i++) {
      if (String(headers[i]).trim() === name) return i;
    }
    return -1;
  }

  var iCase   = idx('Case Number');
  var iDriver = idx('Driver');
  var iStatus = idx('Status');
  var iType   = idx('Type');
  var iTier   = idx('Tier');

  var out = [];
  rows.forEach(function (r) {
    var cn = iCase > -1 ? String(r[iCase]).trim() : '';
    if (!cn) return;
    out.push({
      caseNumber: cn,
      driver: iDriver > -1 ? String(r[iDriver] || '') : '',
      status: iStatus > -1 ? String(r[iStatus] || '') : '',
      type:   iType   > -1 ? String(r[iType]   || '') : '',
      tier:   iTier   > -1 ? String(r[iTier]   || '') : ''
    });
  });

  return out.reverse();
}



/**
 * Payload keys the driver form collects, labelled with the 2026 workbook's own
 * wording. Anything not listed still shows — it gets a prettified version of
 * its key — so a field the form starts collecting tomorrow appears here without
 * anyone updating this map.
 */
var DASH_ANSWER_LABELS = {
  anyoneInjured:          'Is anyone hurt?',
  otherPartiesInjured:    'Was anyone in the other vehicle hurt?',
  medicalAwayFromScene:   'Did anyone leave the scene for medical treatment?',
  pedestrianInvolved:     'Pedestrian or cyclist involved?',
  otherVehicleInvolved:   'Another vehicle involved?',
  otherPartyInvolved:     'Another person or company involved?',
  policeOnScene:          'Police on scene?',
  citationIssued:         'Ticket or citation issued?',
  rollover:               'Rollover or jackknife?',
  hazmatOrFuelSpill:      'Fuel, oil, or fluid leaking?',
  truckDrivable:          'Truck safe to drive?',
  towRequired:            'Anything need towing?',
  vehicleStuck:           'Stuck?',
  freightDamaged:         'Freight damaged?',
  driverRequestsContact:  'Driver asked to be called?',

  injuryType:             'Type of injury',
  medicalAttention:       'Medical attention needed? Type?',
  whoInjured:             'Who was hurt?',

  deerAnimal:             'Deer or animal?',
  otherPartiesDetail:     'Other parties \u2014 names and contact info',
  ourDamageWhat:          'What is damaged on our equipment',
  theirDamageWhat:        'What was damaged (their property)',

  otherDriverPhone:       "Other driver's phone number",
  gaveOurInfo:            'Did they ask for our license and insurance?',
  otherPartyLeftScene:    'Did the other party leave the scene?',
  hitAndRunPlate:         'Partial plate (hit and run)',
  hitAndRunDescription:   'Vehicle description (hit and run)',

  ticketWho:              'Who received the ticket?',
  reportCardNumber:       'Accident report card / number',
  police:                 'Police (post, station, city)',
  officer:                'Officer name and badge #',

  towCompany:             'Tow company',
  towDestination:         'Where is it going?',
  towArrangedBy:          'Who arranged the tow?',

  customerContactName:    'Facility contact name',
  customerContactPhone:   'Facility contact number',

  witness1:               'Witness 1',
  witness2:               'Witness 2',
  witness3:               'Witness 3',
  otherContacts:          'Other contacts',

  dispatchNotified:       'Dispatch notified?',
  breakdownsNotified:     'Breakdowns notified?',
  notes:                  'Driver notes',
  otherExplain:           'Other \u2014 explanation'
};

// Already shown as their own column, or plumbing. Skipped so the block does not
// repeat what is directly above it.
var DASH_ANSWER_SKIP = [
  'driverName','driverFirstName','driverLastName','driver','driverPhone','driverContact','truck','truckNumber',
  'trailer','trailerNumber','dateOfIncident','timeOfIncident','description',
  'city','state','siteName','streetAddress','location','locationName',
  'incidentTypes','incidentType','types','submittedAt','sessionId',
  'notApplicable','answeredNo','otherNaCount','breakdownId','subCategory',
  // Internal checklist row states (ticketRow, freightRow, facilityRow…). They
  // record which sections the wizard opened, which is machinery, not an
  // answer. Riley reading "Facility row: Yes" learns nothing.
  'ticketRow','policeRow','otherVehicleRow','otherDriverInfoRow',
  'otherPropertyRow','freightRow','facilityRow','scenePhotos'
];

/**
 * Everything the driver answered, unpacked from the Payload column.
 *
 * About eighteen fields the 2026 workbook displayed live only in that JSON —
 * injury type, witnesses, police and officer details, who received the ticket,
 * dispatch and breakdown notifications, the driver's own notes. Adding eighteen
 * columns would have made IncidentsData unreadable; parsing the payload keeps
 * the sheet clean and means new form fields appear here for free.
 *
 * Empty answers and photo URLs are dropped — photos have their own block, and a
 * screen of blanks buries the answers that matter.
 */
function driverAnswers_(payloadJson) {
  if (!payloadJson) return [];
  var p;
  try { p = JSON.parse(payloadJson); } catch (e) { return []; }

  function usable(v) {
    if (v === null || v === undefined) return false;
    var s = String(v).trim();
    if (!s) return false;
    if (/^https?:\/\//i.test(s)) return false;
    return true;
  }

  var out = [], used = {};

  Object.keys(DASH_ANSWER_LABELS).forEach(function (k) {
    if (DASH_ANSWER_SKIP.indexOf(k) > -1) return;
    if (!usable(p[k])) return;
    out.push({ label: DASH_ANSWER_LABELS[k], value: String(p[k]) });
    used[k] = true;
  });

  Object.keys(p).forEach(function (k) {
    if (used[k]) return;
    if (DASH_ANSWER_SKIP.indexOf(k) > -1) return;
    if (k.indexOf('photo') === 0) return;
    if (k.charAt(0) === '_') return;
    // Any future checklist row state, caught without updating the skip list.
    if (/Row$/.test(k)) return;
    if (!usable(p[k])) return;
    var label = k.replace(/([A-Z])/g, ' $1')
                 .replace(/^./, function (c) { return c.toUpperCase(); });
    out.push({ label: label, value: String(p[k]) });
  });

  return out;
}

// =============================================================================
// READ ONE
// =============================================================================

/**
 * Returns the shape Dashboard.html expects:
 *   { headers: [], values: {}, locked: [], textareas: [], updates: [] }
 */
function getIncident(caseNumber) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(DATA_TAB);
  if (!sheet) throw new Error('No tab named ' + DATA_TAB);

  var rowNum = rowForCase_(sheet, caseNumber);
  if (!rowNum) throw new Error('Case ' + caseNumber + ' not found.');

  var row = rowObject_(sheet, rowNum);

  var headers = [];
  var values  = {};
  Object.keys(row).forEach(function (h) {
    if (DASH_HIDDEN.indexOf(h) > -1) return;
    headers.push(h);
    var v = row[h];
    // Dates come back as Date objects and render as an unreadable ISO string
    // in a text input. Format them the way the rest of the sheet reads.
    if (v instanceof Date) v = Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm');
    values[h] = v == null ? '' : String(v);
  });

  return {
    headers:   headers,
    values:    values,
    locked:    DASH_LOCKED,
    textareas: DASH_TEXTAREAS,
    answers:   driverAnswers_(row['Payload']),
    updates:   updatesForCase_(caseNumber),
    rowNum:    rowNum
  };
}


// =============================================================================
// SAVE
// =============================================================================

/**
 * Writes changed editable fields and optionally logs a note.
 *
 * The locked check is repeated here on purpose. The client already filters
 * them out, but client-side filtering is a convenience, not a guarantee — a
 * bug or a stale tab could send a locked field, and the driver's submission
 * must not be silently rewritten.
 *
 * Only fields that ACTUALLY changed are written. Rewriting an unchanged cell
 * would churn the revision history and make it harder to see what a person
 * genuinely touched.
 */
function saveIncident(caseNumber, edits, note) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(DATA_TAB);
  if (!sheet) throw new Error('No tab named ' + DATA_TAB);

  var rowNum = rowForCase_(sheet, caseNumber);
  if (!rowNum) throw new Error('Case ' + caseNumber + ' not found.');

  var before = rowObject_(sheet, rowNum);
  var changed = 0;
  var changeLog = [];

  Object.keys(edits || {}).forEach(function (h) {
    if (DASH_LOCKED.indexOf(h) > -1) return;   // never writable
    if (DASH_HIDDEN.indexOf(h) > -1) return;

    var oldVal = before[h];
    if (oldVal instanceof Date) {
      oldVal = Utilities.formatDate(oldVal, TZ, 'yyyy-MM-dd HH:mm');
    }
    oldVal = oldVal == null ? '' : String(oldVal);
    var newVal = edits[h] == null ? '' : String(edits[h]);

    if (oldVal === newVal) return;

    setCell_(sheet, rowNum, h, newVal);
    changed++;
    changeLog.push(h + ': "' + truncate_(oldVal, 40) + '" → "' + truncate_(newVal, 40) + '"');
  });

  // Field edits are recorded in the append-only log too, so the history of an
  // incident is readable in one place rather than requiring someone to dig
  // through Sheets revision history.
  if (changed) {
    saveIncidentUpdate({
      caseNumber: caseNumber,
      category:   'Internal note',
      text:       'Dashboard edit — ' + changeLog.join('; '),
      attachment: ''
    });
  }

  if (note && String(note).trim()) {
    saveIncidentUpdate({
      caseNumber: caseNumber,
      category:   'Internal note',
      text:       String(note).trim(),
      attachment: ''
    });
  }

  return { changed: changed, by: currentUser_() };
}

function truncate_(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}


/**
 * =============================================================================
 * ONE MANUAL EDIT — add the menu item
 * =============================================================================
 *
 * This file deliberately does NOT define onOpen, because
 * incident-workbook-tools.gs already does and two would silently collide.
 *
 * In incident-workbook-tools.gs, add one line to the existing menu:
 *
 *   function onOpen() {
 *     SpreadsheetApp.getUi()
 *       .createMenu('🛡 Safety Incident')
 *       .addItem('Open Incident Dashboard', 'openIncidentDashboard')   // ADD
 *       .addItem('Log update for selected incident…', 'menuLogUpdate')
 *       .addItem('Close & email selected incident…', 'menuCloseIncident')
 *       .addSeparator()
 *       .addItem('Set up tabs (run once)', 'menuSetup')
 *       .addToUi();
 *   }
 *
 * =============================================================================
 * A NOTE ON WHAT IS LOCKED
 * =============================================================================
 *
 * Driver, Truck, and Trailer are locked. That was a judgment call — they are
 * part of what the driver submitted, and the whole value of a locked block is
 * that nobody can quietly revise the original account.
 *
 * The cost is real though: a driver who fat-fingers a truck number leaves a
 * wrong number in the record permanently, corrected only by a log entry.
 *
 * If Riley would rather be able to fix an obvious typo, move those three out of
 * DASH_LOCKED. Every edit is logged either way, so the history survives — it
 * just becomes a correction rather than a prohibition. Worth asking him rather
 * than deciding for him.
 * =============================================================================
 */


/**
 * The full record as printable HTML, for a case at any stage.
 *
 * buildIncidentPrintHTML_ was written for the close step and expects a closing
 * summary and closer. An open incident has neither, so this passes the current
 * status instead and lets the banner say so — a printed copy of a live incident
 * should not look like a finished one.
 */
function getIncidentPrintHtml(caseNumber) {
  var data = SpreadsheetApp.getActive().getSheetByName(DATA_TAB);
  if (!data) throw new Error('No tab named ' + DATA_TAB);

  var rowNum = rowForCase_(data, caseNumber);
  if (!rowNum) throw new Error('Case ' + caseNumber + ' not found.');

  var row     = rowObject_(data, rowNum);
  var updates = updatesForCase_(caseNumber);
  var status  = String(row['Status'] || 'Open');
  var isClosed = status.toLowerCase() === 'closed';

  var summary = isClosed
    ? String(row['Closing Summary'] || '')
    : 'This incident is still open. Printed ' +
      Utilities.formatDate(new Date(), TZ, 'MMM d, yyyy h:mm a') +
      ' — the record may change.';

  var by = isClosed ? String(row['Closed By'] || '') : currentUser_();
  var at = isClosed
    ? String(row['Closed At'] || '')
    : Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm');

  return buildIncidentPrintHTML_(row, updates, summary, by, at);
}


/**
 * Builds the PDF, files it to the incident's Drive folder, and returns a link.
 *
 * Printing straight from inside a Sheets modal dialog is unreliable — the
 * dialog is itself a sandboxed iframe and browsers differ on what they will
 * let it do. Producing a real PDF and handing back a URL sidesteps that
 * entirely: it opens in the browser's own viewer, where Print works the way
 * everyone expects, and the copy is filed alongside the photos.
 */
function makeIncidentPdf(caseNumber) {
  var t0 = new Date().getTime();
  var data = SpreadsheetApp.getActive().getSheetByName(DATA_TAB);
  var rowNum = rowForCase_(data, caseNumber);
  if (!rowNum) throw new Error('Case ' + caseNumber + ' not found.');

  var row    = rowObject_(data, rowNum);
  var driver = String(row['Driver'] || 'Driver').replace(/[^\w \-]/g, '').trim() || 'Driver';
  var stamp  = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmm');

  // Timing is logged because "the PDF is slow" is unactionable without knowing
  // WHICH half is slow: pulling photos out of Drive, or the PDF conversion.
  var html = getIncidentPrintHtml(caseNumber);
  var t1 = new Date().getTime();
  Logger.log('PDF: html built in %ss (%s KB)',
             ((t1 - t0) / 1000).toFixed(1), Math.round(html.length / 1024));

  var pdf  = Utilities.newBlob(html, 'text/html')
    .getAs('application/pdf')
    .setName(caseNumber + '_' + driver + '_' + stamp + '.pdf');
  Logger.log('PDF: converted in %ss', ((new Date().getTime() - t1) / 1000).toFixed(1));

  // Prefer the incident's own folder so the PDF sits with its photos.
  var file = null;
  try {
    var folderId = driveIdFromUrl_(row['Photos — Folder']);
    if (folderId) file = DriveApp.getFolderById(folderId).createFile(pdf);
  } catch (e) { /* fall through */ }

  if (!file) {
    // No photo folder (a photoless incident) — put it somewhere predictable.
    var it = DriveApp.getRootFolder().getFoldersByName('Incident PDFs');
    var folder = it.hasNext() ? it.next()
                              : DriveApp.getRootFolder().createFolder('Incident PDFs');
    file = folder.createFile(pdf);
  }

  Logger.log('PDF: total %ss', ((new Date().getTime() - t0) / 1000).toFixed(1));
  return { url: file.getUrl(), name: file.getName() };
}


/**
 * Emails the record as a PDF attachment.
 *
 * Defaults to safety@norloworld.com but takes any address, because the common
 * real need is sending a copy to an insurer, an attorney, or the driver's
 * manager — and doing that by hand today means downloading and re-attaching.
 *
 * Every send is logged to IncidentUpdates. Who a record went to, and when, is
 * exactly the sort of thing someone asks about a year later.
 */
function emailIncidentPdf(caseNumber, to, note) {
  var data = SpreadsheetApp.getActive().getSheetByName(DATA_TAB);
  var rowNum = rowForCase_(data, caseNumber);
  if (!rowNum) throw new Error('Case ' + caseNumber + ' not found.');

  var recipient = String(to || '').trim() || SAFETY_EMAIL;
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
    throw new Error('That does not look like an email address: ' + recipient);
  }

  var row    = rowObject_(data, rowNum);
  var driver = String(row['Driver'] || 'Driver').replace(/[^\w \-]/g, '').trim() || 'Driver';
  var status = String(row['Status'] || 'Open');

  var html = getIncidentPrintHtml(caseNumber);
  var pdf  = Utilities.newBlob(html, 'text/html')
    .getAs('application/pdf')
    .setName(caseNumber + '_' + driver + '.pdf');

  var body = '';
  if (note && String(note).trim()) body += '<p>' + escapeHtml_(String(note).trim()) + '</p>';
  body += '<p style="color:#666;">Incident ' + escapeHtml_(caseNumber) + ' — ' +
          escapeHtml_(driver) + ' — status: ' + escapeHtml_(status) + '.<br>' +
          'Sent by ' + escapeHtml_(currentUser_()) + '. Full record attached.</p>';

  MailApp.sendEmail({
    to: recipient,
    subject: 'Incident ' + caseNumber + ' — ' + driver +
             (status.toLowerCase() === 'closed' ? ' — closed' : ''),
    htmlBody: body,
    attachments: [pdf]
  });

  saveIncidentUpdate({
    caseNumber: caseNumber,
    category:   'Internal note',
    text:       'Record emailed to ' + recipient +
                (note && String(note).trim() ? ' — "' + String(note).trim() + '"' : ''),
    attachment: ''
  });

  return 'Sent to ' + recipient + '.';
}
