// Incident report structure, derived from the "2026 Incident Report" sheet.
//
// The form branches like an org chart: the user picks one or more Incident
// Types, and each section is shown only when one of its `types` is selected.
// Sections with `types: null` are always shown (core information).
//
// `gates` are the always-asked questions that drive severity tiering — asked of
// every driver on every submission, before the incident-type checkboxes.
// Office-only fields live in OFFICE_SECTIONS (below), which the driver form
// does not render.

export const INCIDENT_TYPES = [
  { key: "accident", label: "Accident (Moving vehicles)" },
  { key: "injury", label: "Injury" },
  { key: "vehicleDamage", label: "Vehicle / Equipment Damage" },
  { key: "propertyDamage", label: "Property Damage" },
  { key: "tow", label: "Tow" },
  { key: "other", label: "Other (Explain)" },
];

// Driver Incident Checklist links from the sheet, surfaced per incident type.
export const CHECKLISTS = {
  accident:
    "https://drive.google.com/file/d/1fvfcgcjv1xEjrIzXUQpXbHI9PiAfn7F8/view?usp=sharing",
  propertyDamage:
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

// Each section: { id, title, subtitle?, types, fields: [{ key, label, type, options?, required?, placeholder? }] }
// field.type: 'text' | 'textarea' | 'date' | 'time' | 'select'
export const SECTIONS = [
  {
    id: "identity",
    title: "Incident Identity",
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
    title: "First — a few quick questions",
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
  {
    id: "injury",
    title: "Injury",
    types: ["injury"],
    fields: [
      { key: "injuryType", label: "If injured, type of injury", type: "text" },
      { key: "medicalAttention", label: "Medical attention needed? Type?", type: "text" },
      { key: "drugTest", label: "Drug test required?", type: "select", options: YESNO },
    ],
  },
  {
    id: "accident",
    title: "Accident Details",
    types: ["accident"],
    fields: [
      { key: "deerAnimal", label: "Deer / Animal accident?", type: "select", options: YESNO },
      { key: "otherPartiesInvolved", label: "Other parties involved? If yes, names and contact info", type: "textarea" },
      { key: "ticket", label: "Who received the ticket?", type: "text" },
    ],
  },
  {
    id: "propertyVehicle",
    title: "Property / Vehicle / Equipment",
    types: ["propertyDamage", "vehicleDamage"],
    fields: [
      { key: "customerContact", label: "Customer Name & Contact Number (if applicable)", type: "text" },
      { key: "equipmentInvolved", label: "Vehicles / Equipment / Property involved", type: "textarea" },
    ],
  },
  {
    id: "tow",
    title: "Tow",
    types: ["tow"],
    fields: [
      { key: "towCompany", label: "Tow company / details", type: "text" },
    ],
  },
  {
    id: "media",
    title: "Photos",
    types: ["accident", "vehicleDamage", "propertyDamage"],
    fields: [
      { key: "photoScene", label: "Wide shot of the whole scene", type: "photo", hint: "Stand back far enough to show everything involved and the road." },
      { key: "photoOurEquipment", label: "Our truck and trailer", type: "photo", hint: "Multiple angles. Include the damage and the unit number." },
      { key: "photoOtherProperty", label: "The other vehicle or property", type: "photo", hint: "All sides, not just the damage." },
      { key: "reportCardNumber", label: "Accident report card or number", type: "text" },
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
    id: "contacts",
    title: "Contacts",
    types: ["accident", "injury", "propertyDamage", "vehicleDamage"],
    fields: [
      { key: "police", label: "Police (identity, post, station, city)", type: "text" },
      { key: "officer", label: "Officer name and badge #", type: "text" },
      { key: "witness1", label: "Witness #1 (if applicable)", type: "text" },
      { key: "witness2", label: "Witness #2 (if applicable)", type: "text" },
      { key: "witness3", label: "Witness #3 (if applicable)", type: "text" },
      { key: "otherContacts", label: "Other contacts", type: "text" },
    ],
  },
  {
    id: "misc",
    title: "Misc",
    types: null,
    fields: [
      { key: "freightAffected", label: "Freight affected?", type: "select", options: YESNO },
      { key: "dispatchNotified", label: "Has dispatch been notified?", type: "select", options: YESNO },
      { key: "breakdownsNotified", label: "Has breakdowns been notified?", type: "select", options: YESNO },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
  },
];

// Office-only sections — Riley and Mark's post-intake work. NOT shown to
// drivers: IncidentForm renders SECTIONS only. The office dashboard renders
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
