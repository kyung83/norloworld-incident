// Renders a single schema field by type. Controlled via value/onChange.

const inputClasses = (invalid) =>
  `mt-1 block w-full rounded-md border px-3 py-2 text-base shadow-sm focus:outline-none bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 sm:text-sm ${
    invalid
      ? "border-red-500"
      : "border-gray-300 dark:border-gray-600 focus:ring-indigo-500 focus:border-indigo-500"
  }`;

export default function Field({ field, value, onChange, invalid }) {
  const { key, label, type, options, required, placeholder } = field;
  const v = value ?? "";

  return (
    <div className="flex flex-col">
      <label
        htmlFor={key}
        className="block text-sm font-medium leading-6 text-gray-900 dark:text-gray-100"
      >
        {required ? "* " : ""}
        {label}
      </label>

      {type === "textarea" ? (
        <textarea
          id={key}
          rows={4}
          value={v}
          placeholder={placeholder}
          onChange={(e) => onChange(key, e.target.value)}
          className={inputClasses(invalid)}
        />
      ) : type === "select" ? (
        <select
          id={key}
          value={v}
          onChange={(e) => onChange(key, e.target.value)}
          className={inputClasses(invalid)}
        >
          <option value="">—</option>
          {(options || []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={key}
          type={type === "date" ? "date" : type === "time" ? "time" : "text"}
          value={v}
          placeholder={placeholder}
          onChange={(e) => onChange(key, e.target.value)}
          className={inputClasses(invalid)}
        />
      )}
    </div>
  );
}
