import { TextField } from "@/components/auth/text-field";

/**
 * 生年月日の入力欄（本人のみ確認・編集）。サロンへは表示されず、公開中の場合に満年齢だけが表示される。
 * 任意入力。空のまま保存すると「未登録」になる（年代から年齢を推測することはしない）。
 */
export function BirthDateField({ defaultValue, errors }: { defaultValue: string; errors?: string[] }) {
  return (
    <div>
      <TextField
        id="birthDate"
        name="birthDate"
        label="生年月日（任意）"
        type="date"
        required={false}
        defaultValue={defaultValue}
        errors={errors}
      />
      <p className="mt-1.5 text-[12px] leading-relaxed text-sub">
        生年月日そのものはサロンに表示されません。公開中のときだけ、満年齢（例: 28歳）が表示されます。未入力の場合、年齢は「未登録」と表示されます。
      </p>
    </div>
  );
}
