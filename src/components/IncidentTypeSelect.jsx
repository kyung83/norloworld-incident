import { INCIDENT_TYPES, CHECKLISTS } from "../incidentSchema";

// Check-all-that-apply Incident Type selector. This drives which sections of
// the form are revealed (the branching). Also surfaces the type-specific
// Driver Incident Checklist link when available.
export default function IncidentTypeSelect({ selected, onToggle, isInvalid }) {
  return (
    <fieldset>
      <legend
        className={`block text-sm font-medium leading-6 ${
          isInvalid ? "text-red-600" : "text-gray-900 dark:text-gray-100"
        }`}
      >
        * Incident Type — check all that apply
      </legend>

      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
        {INCIDENT_TYPES.map((t) => {
          const checked = selected.includes(t.key);
          return (
            <label
              key={t.key}
              className={`flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer ${
                checked
                  ? "border-indigo-500 bg-indigo-50 dark:bg-gray-700"
                  : "border-gray-300 dark:border-gray-600"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(t.key)}
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span className="text-sm text-gray-900 dark:text-gray-100">
                {t.label}
              </span>
            </label>
          );
        })}
      </div>

      {selected.some((k) => CHECKLISTS[k]) && (
        <div className="mt-3 space-y-1">
          {INCIDENT_TYPES.filter(
            (t) => selected.includes(t.key) && CHECKLISTS[t.key]
          ).map((t) => (
            <a
              key={t.key}
              href={CHECKLISTS[t.key]}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-sm text-indigo-600 dark:text-indigo-400 underline"
            >
              Driver Incident Checklist ({t.label}) →
            </a>
          ))}
        </div>
      )}

      {isInvalid && (
        <p className="mt-1 text-sm text-red-600">
          Select at least one incident type.
        </p>
      )}
    </fieldset>
  );
}
