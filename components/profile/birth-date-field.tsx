import { TextField } from "@/components/auth/text-field";

/**
 * 生年月日の入力欄（必須。本人のみ確認・編集）。生年月日そのものはサロンに表示されない。
 * 日本時間の今日を基準に満年齢が自動計算され、サロンには（選択した方法で）満年齢または年代だけが表示される。
 * 登録済みの生年月日を空にして保存することはできない。年代から年齢を推測することはしない。
 */
export function BirthDateField({ defaultValue, errors }: { defaultValue: string; errors?: string[] }) {
  return (
    <div>
      <TextField
        id="birthDate"
        name="birthDate"
        label="生年月日"
        type="date"
        required
        defaultValue={defaultValue}
        errors={errors}
      />
      <p className="mt-1.5 text-[12px] leading-relaxed text-sub">
        生年月日そのものはサロンに表示されません。満年齢は日本時間の今日を基準に自動計算され、下で選んだ方法（実年齢または年代）でだけ表示されます。登録が済むまで、サロン向けの一覧には表示されません。
      </p>
    </div>
  );
}
