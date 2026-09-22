import { FieldError } from "@/components/auth/form-messages";

type Props = {
  id: string;
  name: string;
  label: string;
  defaultValue?: string;
  maxLength?: number;
  rows?: number;
  required?: boolean;
  errors?: string[];
  /**
   * 任意のonChangeコールバック。既存の呼び出し元（profile-form.tsx等）は
   * 渡さないため挙動は変わらない（後方互換）。React stateで値を追跡したい
   * 呼び出し元（salon-culture-wizard.tsx等）向けに追加。
   */
  onChange?: (value: string) => void;
};

export function TextareaField({
  id,
  name,
  label,
  defaultValue,
  maxLength,
  rows = 5,
  required = false,
  errors,
  onChange,
}: Props) {
  return (
    <div>
      {label && (
        <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium text-charcoal">
          {label}
        </label>
      )}
      <textarea
        id={id}
        name={name}
        rows={rows}
        maxLength={maxLength}
        required={required}
        defaultValue={defaultValue}
        onChange={onChange ? (e: { target: { value: string } }) => onChange(e.target.value) : undefined}
        aria-invalid={errors && errors.length > 0 ? true : undefined}
        className="w-full resize-y rounded-xl border border-line bg-surface px-4 py-3 text-[15px] text-ink outline-none focus:border-ink"
      />
      <FieldError messages={errors} />
    </div>
  );
}
