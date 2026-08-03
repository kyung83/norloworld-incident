// Incident report structure, derived from the "2026 Incident Report" sheet.
//
// The form branches like an org chart: the driver picks one or more Incident
// Types, and a section shows when its `types` match AND its `showIf` gate (if
// any) holds. Sections with `types: null` and no showIf are always shown.
//
// `gates` are the always-asked questions that drive severity tiering — asked of
// every driver on every submission, before the incident-type checkboxes.
// Office-only fields live in OFFICE_SECTIONS (below), which the driver form
// does not render.

export const INCIDENT_TYPES = [
  { key: "accident", label: "Accident (Moving vehicles)" },
  { key: "injury", label: "Injury" },
  { key: "damageOurs", label: "Damage — our truck, trailer, or equipment" },
  { key: "damageTheirs", label: "Damage — someone else's property or vehicle" },
  { key: "tow", label: "Tow" },
  { key: "other", label: "Other (Explain)" },
];
// Historical note: the old keys were `vehicleDamage` and `propertyDamage`.
// Records from before this change use those labels. Year-over-year counts need
// the mapping vehicleDamage → damageOurs, propertyDamage → damageTheirs (with
// the caveat that the old pair overlapped and the new one does not).

// Driver Incident Checklist links from the sheet, surfaced per incident type.
export const CHECKLISTS = {
  accident:
    "https://drive.google.com/file/d/1fvfcgcjv1xEjrIzXUQpXbHI9PiAfn7F8/view?usp=sharing",
  damageTheirs:
    "https://drive.google.com/file/d/1W4TK-RkFFcGAsXR2mjuXh-hVXPTp4idN/view?usp=sharing",
};

const YESNO = ["Yes", "No", "N/A"];
const YNU = ["Yes", "No", "Unknown"];
const YN = ["Yes", "No"];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY","DC","ON","QC",
];

// Each section: { id, title, subtitle?, types, showIf?, fields: [...] }
// field: { key, label, type, options?, required?, requiredIf?, skipReasonKey?, hint?, placeholder? }
// field.type: 'text' | 'textarea' | 'date' | 'time' | 'select' | 'photo'
export const SECTIONS = [
  {
    id: "identity",
    title: "Driver and Vehicle Information",
    types: null,
    fields: [
      { key: "driverName", label: "Last Name, First Name", type: "text", required: true },
      { key: "truckNumber", label: "Northern Truck #", type: "text", required: true },
      { key: "trailerNumber", label: "Northern Trailer #", type: "text", required: true },
      { key: "dateOfIncident", label: "Date of Incident", type: "date", required: true },
      { key: "timeOfIncident", label: "Time of Incident", type: "time" },
    ],
  },
  {
    id: "gates",
    title: "Initial Assessment",
    subtitle: "If anyone is hurt, stop and call the driver line, option 6.",
    types: null, // ALWAYS shown — these drive severity tiering.
    fields: [
      // people
      { key: "anyoneInjured", label: "Is anyone hurt — you, another driver, or a bystander?", type: "select", options: YNU, required: true },
      { key: "medicalAwayFromScene", label: "Did anyone leave the scene for medical treatment?", type: "select", options: YNU, required: true },
      { key: "pedestrianInvolved", label: "Was a pedestrian or cyclist involved?", type: "select", options: YNU, required: true },
      // other parties
      { key: "otherVehicleInvolved", label: "Was another vehicle involved?", type: "select", options: YNU, required: true },
      { key: "otherPartyInvolved", label: "Is there another person or company involved in any way?", type: "select", options: YNU, required: true },
      // authorities
      { key: "policeOnScene", label: "Are police on scene, or was a report taken?", type: "select", options: YNU, required: true },
      { key: "citationIssued", label: "Was anyone issued a ticket or citation?", type: "select", options: YNU, required: true },
      // the equipment
      { key: "rollover", label: "Did the truck roll over or jackknife?", type: "select", options: YNU, required: true },
      { key: "hazmatOrFuelSpill", label: "Is fuel, oil, or any other fluid leaking?", type: "select", options: YNU, required: true },
      { key: "truckDrivable", label: "Is the truck safe to drive right now?", type: "select", options: YNU, required: true },
      { key: "towRequired", label: "Does anything need to be towed?", type: "select", options: YNU, required: true },
      { key: "vehicleStuck", label: "Are you stuck?", type: "select", options: YNU, required: true },
      { key: "freightDamaged", label: "Was the load damaged?", type: "select", options: YNU, required: true },
      // the override
      { key: "driverRequestsContact", label: "Do you need someone to call you right now?", type: "select", options: YN, required: true },
    ],
  },
  {
    id: "intake",
    title: "Where did this happen?",
    types: null,
    fields: [
      { key: "siteName", label: "Company or place name", type: "text", placeholder: "Customer name, truck stop, rest area" },
      { key: "streetAddress", label: "Street address or nearest cross street", type: "text", placeholder: "Or mile marker and direction", required: true },
      { key: "city", label: "City", type: "text", required: true },
      { key: "state", label: "State", type: "select", options: US_STATES, required: true },
      { key: "driverPhone", label: "Best number to reach you", type: "text", placeholder: "989-555-0100" },
    ],
  },
  // --- Injury ----------------------------------------------------------------
  {
    id: "injury",
    title: "Injury",
    types: ["injury"],
    fields: [
      { key: "injuryType", label: "Type of injury", type: "text", required: true },
      { key: "medicalAttention", label: "Medical attention needed? What kind?", type: "text" },
      { key: "whoInjured", label: "Who was hurt?", type: "text", required: true },
    ],
  },
  // --- Accident detail -------------------------------------------------------
  {
    id: "accident",
    title: "What happened",
    types: ["accident"],
    fields: [
      { key: "deerAnimal", label: "Deer or animal?", type: "select", options: YN },
      { key: "otherPartiesDetail", label: "Other parties involved — names and contact info", type: "textarea", requiredIf: { key: "otherPartyInvolved", equals: "Yes" }, skipReasonKey: "otherPartiesDetailSkipped" },
    ],
  },
  // --- Our equipment ---------------------------------------------------------
  {
    id: "damageOurs",
    title: "Our equipment",
    types: ["damageOurs"],
    fields: [
      { key: "ourDamageWhat", label: "What is damaged?", type: "textarea", placeholder: "Tractor, trailer, tires, mirror, reefer unit…", required: true },
      { key: "photoOurEquipment", label: "Close-ups of the damage", type: "photo", hint: "Include the unit number in at least one shot.", required: true, skipReasonKey: "photoOurEquipmentSkipped" },
    ],
  },
  // --- Their property --------------------------------------------------------
  {
    id: "damageTheirs",
    title: "The other party's property",
    types: ["damageTheirs"],
    fields: [
      { key: "theirDamageWhat", label: "What was damaged?", type: "textarea", placeholder: "Building, dock, pole, fence, parked vehicle…", required: true },
      { key: "photoOtherProperty", label: "Photos of the damage", type: "photo", hint: "All sides, not just the damaged area.", required: true, skipReasonKey: "photoOtherPropertySkipped" },
      { key: "customerContactName", label: "Name of someone at the facility", type: "text", hint: "From the property damage checklist — safety needs a person to call.", required: true, skipReasonKey: "customerContactSkipped" },
      { key: "customerContactPhone", label: "Their phone number", type: "text" },
    ],
  },
  // --- Tow -------------------------------------------------------------------
  {
    id: "tow",
    title: "Tow",
    types: ["tow"],
    fields: [
      { key: "towCompany", label: "Tow company", type: "text" },
      { key: "towDestination", label: "Where is it going?", type: "text" },
      { key: "towArrangedBy", label: "Who arranged it?", type: "select", options: ["Breakdown", "Safety", "Police ordered it", "I did", "Not arranged yet"] },
    ],
  },
  // --- Photos, core ----------------------------------------------------------
  {
    id: "photosCore",
    title: "Photos",
    subtitle: "Make sure it is safe before taking any pictures.",
    types: ["accident", "damageOurs", "damageTheirs", "tow"],
    fields: [
      { key: "photoScene", label: "Wide shot of the whole scene", type: "photo", hint: "Stand back far enough to show everything involved and the road.", required: true, skipReasonKey: "photoSceneSkipped" },
    ],
  },
  // --- The other driver ------------------------------------------------------
  {
    id: "otherDriver",
    title: "The other driver",
    subtitle: "Never argue with the other party. It is what it is regardless of fault — we work it out on the back end.",
    types: null,
    showIf: { key: "otherVehicleInvolved", equals: "Yes" },
    fields: [
      { key: "photoOtherId", label: "Photo of their driver's license", type: "photo", required: true, skipReasonKey: "photoOtherIdSkipped" },
      { key: "photoOtherInsurance", label: "Photo of their insurance card", type: "photo", required: true, skipReasonKey: "photoOtherInsuranceSkipped" },
      { key: "otherDriverPhone", label: "Their phone number", type: "text", required: true, skipReasonKey: "otherDriverPhoneSkipped" },
      { key: "photoOtherVehicle", label: "Their vehicle — damaged area plus all other sides", type: "photo", hint: "All four sides. This protects us against damage claimed later.", required: true, skipReasonKey: "photoOtherVehicleSkipped" },
      { key: "gaveOurInfo", label: "Did they ask for your license and insurance?", type: "select", options: ["Yes, I provided it", "They did not ask", "No, I did not provide it"] },
    ],
  },
  // --- Citation --------------------------------------------------------------
  {
    id: "citation",
    title: "The ticket",
    types: null,
    showIf: { key: "citationIssued", equals: "Yes" },
    fields: [
      { key: "photoTicket", label: "Photo of the ticket", type: "photo", required: true, skipReasonKey: "photoTicketSkipped" },
      { key: "ticketWho", label: "Who received it?", type: "text", required: true },
    ],
  },
  // --- Police ----------------------------------------------------------------
  {
    id: "policeDetail",
    title: "Police",
    types: null,
    showIf: { key: "policeOnScene", equals: "Yes" },
    fields: [
      { key: "photoPoliceReport", label: "Photo of the report, info exchange page, or officer's card", type: "photo", hint: "Whatever they hand you. The crash report number is the important part.", required: true, skipReasonKey: "photoPoliceReportSkipped" },
      { key: "reportCardNumber", label: "Crash report number", type: "text" },
      { key: "officer", label: "Officer name and badge number", type: "text" },
      { key: "police", label: "Post, station, or city", type: "text" },
    ],
  },
  // --- Freight ---------------------------------------------------------------
  {
    id: "freight",
    title: "Freight",
    types: null,
    showIf: { key: "freightDamaged", equals: "Yes" },
    fields: [
      { key: "photoLoadWide", label: "The entire load in the van or on the trailer", type: "photo", required: true, skipReasonKey: "photoLoadWideSkipped" },
      { key: "photoLoadDamage", label: "Close-ups of the damaged freight", type: "photo", required: true, skipReasonKey: "photoLoadDamageSkipped" },
    ],
  },
  // --- Witnesses -------------------------------------------------------------
  {
    id: "witnesses",
    title: "Witnesses",
    types: ["accident", "injury", "damageTheirs"],
    fields: [
      { key: "witness1", label: "Witness 1 — name and number", type: "text" },
      { key: "witness2", label: "Witness 2 — name and number", type: "text" },
      { key: "witness3", label: "Witness 3 — name and number", type: "text" },
      { key: "otherContacts", label: "Anyone else", type: "text" },
    ],
  },
  {
    id: "other",
    title: "Other",
    types: ["other"],
    fields: [
      { key: "otherExplain", label: "Other (explain)", type: "textarea" },
    ],
  },
  {
    id: "description",
    title: "Description",
    types: null,
    fields: [
      { key: "description", label: "Brief description of what happened", type: "textarea", required: true },
    ],
  },
  {
    id: "misc",
    title: "Misc",
    types: null,
    fields: [
      { key: "dispatchNotified", label: "Has dispatch been notified?", type: "select", options: YESNO },
      { key: "breakdownsNotified", label: "Has breakdowns been notified?", type: "select", options: YESNO },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
  },
];

// Office-only sections — Riley and Mark's post-intake work. NOT shown to
// drivers: the wizard renders SECTIONS only. The office dashboard renders
// OFFICE_SECTIONS.
export const OFFICE_SECTIONS = [
  {
    id: "officeIntake",
    title: "Office — Intake Review",
    types: null,
    fields: [
      { key: "intakeMember", label: "Incident intake team member / Phone Number", type: "text" },
      { key: "reportedCorrectly", label: "Was this incident reported correctly (Driver line – option 6)?", type: "select", options: YESNO },
      { key: "advisedNoContact", label: "Advised driver not to contact other people?", type: "select", options: YESNO },
      { key: "coachingDb", label: "Submitted to Norlo Coaching Database?", type: "select", options: YESNO },
    ],
  },
  {
    id: "officeVideo",
    title: "Office — Video Follow-up",
    types: null,
    fields: [
      { key: "videoPulled", label: "Has video been pulled?", type: "select", options: YESNO },
      { key: "videoProves", label: "Does video PROVE the other party is at fault?", type: "select", options: YNU },
      { key: "videoSent", label: "Was video sent to driver / officer?", type: "select", options: YESNO },
    ],
  },
];

// Every driver field key in the schema, in order — handy for building the
// payload and mapping to sheet columns.
export const ALL_FIELD_KEYS = SECTIONS.flatMap((s) => s.fields.map((f) => f.key));

// Office-only field keys, for the dashboard / backend column mapping.
export const OFFICE_FIELD_KEYS = OFFICE_SECTIONS.flatMap((s) =>
  s.fields.map((f) => f.key)
);
