import { FieldError } from "@/components/auth/form-messages";

type Props = {
  name: string;
  label: string;
  options: readonly string[];
  defaultValues?: string[];
  errors?: string[];
};

export function CheckboxGroupField({ name, label, options, defaultValues = [], errors }: Props) {
  return (
    <div>
      <span className="mb-1.5 block text-[13px] font-medium text-charcoal">{label}</span>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const id = `${name}-${opt}`;
          return (
            <label
              key={opt}
              htmlFor={id}
              className="flex cursor-pointer items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-[13px] text-charcoal has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-surface"
            >
              <input
                id={id}
                type="checkbox"
                name={name}
                value={opt}
                defaultChecked={defaultValues.includes(opt)}
                className="sr-only"
              />
              {opt}
            </label>
          );
        })}
      </div>
      <FieldError messages={errors} />
    </div>
  );
}
