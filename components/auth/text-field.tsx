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
  /**
   * value/onChangeを指定すると制御コンポーネントになる（未指定時は従来どおり
   * defaultValueによる非制御コンポーネント。既存の呼び出し元はすべて
   * value/onChangeを渡していないため、挙動は一切変わらない）。
   * ログインフォームのように、送信失敗後も入力値を保持したい場合に使う
   * （Reactのform action完了後の自動リセットは非制御な入力にのみ働くため）。
   */
  value?: string;
  onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
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
  value,
  onChange,
  placeholder,
  errors,
}: Props) {
  const controlledProps = onChange ? { value: value ?? "", onChange } : { defaultValue };
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
        {...controlledProps}
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
