import { FieldError } from "@/components/auth/form-messages";

type Option = { value: string; label: string };

type Props = {
  id: string;
  name: string;
  label: string;
  options: Option[];
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  errors?: string[];
};

export function SelectField({
  id,
  name,
  label,
  options,
  defaultValue,
  placeholder,
  required = true,
  errors,
}: Props) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-charcoal">
        {label}
      </label>
      <select
        id={id}
        name={name}
        required={required}
        defaultValue={defaultValue ?? ""}
        aria-invalid={errors && errors.length > 0 ? true : undefined}
        className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-[15px] text-ink outline-none focus:border-ink"
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldError messages={errors} />
    </div>
  );
}
