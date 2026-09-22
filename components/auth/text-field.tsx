import { FieldError } from "./form-messages";

type Props = {
  id: string;
  name: string;
  label: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string;
  placeholder?: string;
  errors?: string[];
};

/** ラベル・入力欄・フィールドエラーをまとめた共通コンポーネント。 */
export function TextField({
  id,
  name,
  label,
  type = "text",
  autoComplete,
  required = true,
  defaultValue,
  placeholder,
  errors,
}: Props) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-charcoal">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        defaultValue={defaultValue}
        placeholder={placeholder}
        aria-invalid={errors && errors.length > 0 ? true : undefined}
        aria-describedby={errors && errors.length > 0 ? `${id}-error` : undefined}
        className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-[15px] text-ink outline-none focus:border-ink"
      />
      <div id={`${id}-error`}>
        <FieldError messages={errors} />
      </div>
    </div>
  );
}
