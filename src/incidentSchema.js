// Incident report structure, derived from the "2026 Incident Report" sheet.
//
// The form branches like an org chart: the driver picks one or more Incident
// Types, and a section shows when its `types` match AND its `showIf` gate (if
// any) holds. Sections with `types: null` and no showIf are always shown.
// `alsoShowIf: { key, equals }` is an OR escape hatch: the section also shows
// whenever that gate answer holds, regardless of type — used where a gate has
// already established the need (e.g. anyoneInjured = Yes surfaces the injury
// section even if the driver only checked Accident).
//
// `gates` are the always-asked questions that drive severity tiering — asked of
// every driver on every submission, before the incident-type checkboxes.
//
// The `checklist` section is special: it holds `rows` (not `fields`) rendered
// as Yes/No/N-A checklist rows with reveal-on-answer. See its rows below and
// the renderer in IncidentFormWizard.jsx.
//
// Office-only fields live in OFFICE_SECTIONS (below), which the driver form
// does not render.

export const INCIDENT_TYPES = [
  { key: "accident", label: "Accident (Moving vehicles)" },
  { key: "animalStrike", label: "Animal strike (deer, etc.)" },
  { key: "injury", label: "Injury" },
  { key: "damageOurs", label: "Damage — our truck, trailer, or equipment" },
  { key: "damageTheirs", label: "Damage — someone else's property or vehicle" },
  { key: "tow", label: "Tow" },
  { key: "other", label: "Other (Explain)" },
];

// Driver Incident Checklist links from the sheet, surfaced in the checklist.
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

// Section: { id, title, subtitle?, types, showIf?, fields? | rows? }
// field: { key, label, type, options?, required?, requiredIf?, hint?, placeholder? }
// field.type: 'text' | 'textarea' | 'date' | 'time' | 'select' | 'photo'
export const SECTIONS = [
  {
    id: "identity",
    title: "Driver and Vehicle Information",
    types: null,
    fields: [
      { key: "driverName", label: "Last Name, First Name", type: "text", required: true },
      { key: "truckNumber", label: "Northern Truck #", type: "text", inputMode: "numeric", required: true },
      { key: "trailerNumber", label: "Northern Trailer #", type: "text", inputMode: "numeric", required: true },
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
      { key: "anyoneInjured", label: "Are you or anyone in your truck hurt?", type: "select", options: YNU, required: true },
      { key: "otherPartiesInjured", label: "Is anyone in the other vehicle hurt?", type: "select", options: YNU, required: true, showIf: { key: "anyoneInjured", equals: "Yes" } },
      { key: "medicalAwayFromScene", label: "Did anyone leave the scene for medical treatment?", type: "select", options: YNU, required: true },
      { key: "pedestrianInvolved", label: "Was a pedestrian or cyclist involved?", type: "select", options: YNU, required: true },
      { key: "otherVehicleInvolved", label: "Was another vehicle involved?", type: "select", options: YNU, required: true },
      { key: "otherPartyInvolved", label: "Did you hit anything that isn't ours?", sublabel: "A building, fence, pole, parked car, a customer's dock — anything belonging to someone else.", type: "select", options: YNU, required: true, showIf: { key: "otherVehicleInvolved", notEquals: "Yes" } },
      { key: "policeOnScene", label: "Are police on scene, or was a report taken?", type: "select", options: YNU, required: true },
      { key: "citationIssued", label: "Was anyone issued a ticket or citation?", type: "select", options: YNU, required: true },
      { key: "rollover", label: "Did the truck roll over or jackknife?", type: "select", options: YNU, required: true },
      { key: "hazmatOrFuelSpill", label: "Is fuel, oil, or any other fluid leaking?", type: "select", options: YNU, required: true },
      { key: "truckDrivable", label: "Is the truck safe to drive right now?", type: "select", options: YNU, required: true },
      { key: "towRequired", label: "Does anything need to be towed?", type: "select", options: YNU, required: true },
      { key: "vehicleStuck", label: "Are you stuck?", type: "select", options: YNU, required: true },
      { key: "freightDamaged", label: "Was the load damaged?", type: "select", options: YNU, required: true },
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
      { key: "driverPhone", label: "Best number to reach you", type: "text", inputMode: "numeric", placeholder: "989-555-0100" },
    ],
  },
  {
    id: "injury",
    title: "Injury",
    types: ["injury"],
    alsoShowIf: { key: "anyoneInjured", equals: "Yes" }, // hurt → ask, even if only Accident was checked

    fields: [
      { key: "injuryType", label: "Type of injury", type: "text", required: true },
      { key: "medicalAttention", label: "Medical attention needed? What kind?", type: "text" },
      { key: "whoInjured", label: "Who was hurt?", type: "text", required: true },
    ],
  },
  {
    id: "accident",
    title: "What happened",
    types: ["accident"],
    alsoShowIf: { key: "otherPartyInvolved", equals: "Yes" }, // another party → collect their info on any type

    fields: [
      { key: "otherPartiesDetail", label: "Other parties involved — names and contact info", type: "textarea", requiredIf: { key: "otherPartyInvolved", equals: "Yes" } },
    ],
  },
  {
    id: "damageOurs",
    title: "Our equipment",
    types: ["damageOurs", "animalStrike"],
    fields: [
      { key: "ourDamageWhat", label: "What is damaged?", type: "textarea", placeholder: "Tractor, trailer, tires, mirror, reefer unit…", required: true },
    ],
  },
  {
    id: "damageTheirs",
    title: "The other party's property",
    types: ["damageTheirs"],
    fields: [
      { key: "theirDamageWhat", label: "What was damaged?", type: "textarea", placeholder: "Building, dock, pole, fence, parked vehicle…", required: true },
    ],
  },
  {
    id: "tow",
    title: "Tow",
    types: ["tow"],
    alsoShowIf: { key: "towRequired", equals: "Yes" }, // needs a tow → ask, even if Tow wasn't checked

    fields: [
      { key: "towCompany", label: "Tow company", type: "text" },
      { key: "towDestination", label: "Where is it going?", type: "text" },
      { key: "towArrangedBy", label: "Who arranged it?", type: "select", options: ["Breakdown", "Safety", "Police ordered it", "I did", "Not arranged yet"] },
    ],
  },

  // --- Checklist: Yes / No / N-A rows with reveal-on-answer -------------------
  {
    id: "checklist",
    title: "Incident checklist",
    subtitle:
      "Make sure the environment is safe before taking any pictures. Never be argumentative with the other parties — it is what it is regardless of fault, and we work it out on the back end.",
    types: ["accident", "damageOurs", "damageTheirs", "tow", "animalStrike"],
    rows: [
      // Always required. No three-button row, no N/A: a wide shot and pictures
      // of our own truck are possible at every incident, on any phone.
      {
        key: "scenePhotos",
        type: "alwaysRequired",
        label: "Pictures of the scene",
        fields: [
          { key: "photoScene", label: "Wide shot of the incident scene", type: "photo", hint: "Stand back far enough to show everything involved and the road.", required: true },
          { key: "photoOurEquipment", label: "Close-ups of damage to Northern equipment", type: "photo", hint: "Include the unit number in at least one shot.", required: true },
        ],
      },
      // Locked: the gates already answered these.
      {
        key: "ticketRow",
        type: "checklistRow",
        label: "Was a ticket issued?",
        answeredBy: "citationIssued",
        revealOn: "Yes",
        fields: [
          { key: "photoTicket", label: "Picture of the ticket", type: "photo", required: true },
          { key: "ticketWho", label: "Who received it?", type: "text", required: true },
        ],
      },
      {
        key: "policeRow",
        type: "checklistRow",
        label: "Were police involved?",
        answeredBy: "policeOnScene",
        revealOn: "Yes",
        naReasons: ["Officer did not provide anything", "Report will be mailed later", "Still on scene waiting"],
        fields: [
          { key: "photoPoliceReport", label: "Picture of the report, info exchange page, or the officer's card", type: "photo", hint: "Whatever they hand you. The crash report number is the important part.", required: true },
          { key: "reportCardNumber", label: "Crash report number", type: "text", required: true },
          { key: "officer", label: "Officer name and badge number", type: "text" },
          { key: "police", label: "Post, station, or city", type: "text" },
        ],
      },
      {
        key: "otherVehicleRow",
        type: "checklistRow",
        label: "Was another vehicle involved?",
        answeredBy: "otherVehicleInvolved",
        revealOn: "Yes",
        fields: [
          { key: "photoOtherVehicle", label: "Their vehicle — damaged area plus all other sides", type: "photo", hint: "All four sides. This is what protects us from damage claimed later.", required: true },
        ],
      },
      // Asked: full three buttons.
      {
        key: "otherDriverInfoRow",
        type: "checklistRow",
        label: "Did you get the other driver's information?",
        sublabel: "ID, insurance, and phone number",
        showIf: { key: "otherVehicleInvolved", equals: "Yes" },
        revealOn: "Yes",
        naReasons: ["They left the scene", "They refused", "Police handled the exchange", "Other — I'll explain"],
        naFollowUp: {
          when: "They left the scene",
          fields: [
            { key: "hitAndRunPlate", label: "Did you get any part of their plate?", type: "text", placeholder: "Even partial, or what you remember", required: true },
            { key: "hitAndRunDescription", label: "Describe the vehicle", type: "textarea", placeholder: "Make, model, color, direction of travel, damage you saw", required: true },
          ],
        },
        fields: [
          { key: "photoOtherId", label: "Picture of their ID", type: "photo", required: true },
          { key: "photoOtherInsurance", label: "Picture of their insurance info", type: "photo", required: true },
          { key: "otherDriverPhone", label: "Their phone number", type: "text", inputMode: "numeric", required: true },
          { key: "gaveOurInfo", label: "Did they ask for your license and insurance?", type: "select", options: ["Yes, I provided it", "They did not ask"], required: true },
        ],
      },
      {
        key: "otherPropertyRow",
        type: "checklistRow",
        label: "Was property or another vehicle damaged?",
        revealOn: "Yes",
        naReasons: ["Owner not present", "Not safe to approach", "Vehicle left the scene", "Other — I'll explain"],
        fields: [
          { key: "photoOtherProperty", label: "Close-ups of the damage", type: "photo", hint: "All sides, not just the damaged area.", required: true },
        ],
      },
      {
        key: "freightRow",
        type: "checklistRow",
        label: "Was freight damaged?",
        revealOn: "Yes",
        fields: [
          { key: "photoLoadWide", label: "The entire load in the van or on the trailer", type: "photo", required: true },
          { key: "photoLoadDamage", label: "Close-ups of the damaged freight", type: "photo", required: true },
        ],
      },
      {
        key: "facilityRow",
        type: "checklistRow",
        label: "Did the damage happen at a customer facility?",
        showIfTypes: ["damageTheirs"],
        revealOn: "Yes",
        naReasons: ["Facility closed, nobody there", "Nobody would give a name", "Other — I'll explain"],
        fields: [
          { key: "customerContactName", label: "Name of a contact at the facility", type: "text", required: true },
          { key: "customerContactPhone", label: "Their phone number", type: "text", inputMode: "numeric", required: true },
        ],
      },
    ],
  },

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
// drivers: the wizard renders SECTIONS only. The office dashboard renders these.
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

// Every driver field key that lives directly on a section (not checklist rows).
export const ALL_FIELD_KEYS = SECTIONS.flatMap((s) =>
  (s.fields || []).map((f) => f.key)
);

// Office-only field keys, for the dashboard / backend column mapping.
export const OFFICE_FIELD_KEYS = OFFICE_SECTIONS.flatMap((s) =>
  s.fields.map((f) => f.key)
);
