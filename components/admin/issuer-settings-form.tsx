"use client";

import { useState } from "react";
import { saveIssuerSettingsAction, type IssuerSettingsInput } from "@/lib/invoices/actions";

const FIELDS: Array<{ key: keyof IssuerSettingsInput; label: string; hint?: string; type?: string }> = [
  { key: "legal_name", label: "法人名（正式名称）" },
  { key: "postal_code", label: "郵便番号", hint: "例：150-0001" },
  { key: "address", label: "住所" },
  { key: "invoice_registration_number", label: "適格請求書発行事業者の登録番号", hint: "T＋13桁の数字" },
  { key: "phone", label: "電話番号" },
  { key: "email", label: "メールアドレス", type: "email" },
  { key: "bank_name", label: "振込先：銀行名" },
  { key: "bank_branch_name", label: "振込先：支店名" },
  { key: "bank_account_number", label: "振込先：口座番号", hint: "数字のみ" },
  { key: "bank_account_holder", label: "振込先：口座名義" },
];

/** 発行事業者・振込先の設定（運営者のみ）。正規化・検証はDBが行う。 */
export function IssuerSettingsForm({ initial }: { initial: IssuerSettingsInput }) {
  const [values, setValues] = useState<IssuerSettingsInput>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const result = await saveIssuerSettingsAction(values);
    setBusy(false);
    setMessage(result.success ? { ok: true, text: result.message } : { ok: false, text: result.error });
  }

  return (
    <form onSubmit={save} className="mt-6 space-y-4 rounded-2xl border border-line bg-surface p-5">
      {FIELDS.slice(0, 6).map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint} type={f.type} value={values[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} disabled={busy} />
      ))}
      <label className="block text-[11px] text-sub">振込先：口座種別
        <select value={values.bank_account_type} disabled={busy}
          onChange={(e) => setValues({ ...values, bank_account_type: e.target.value as IssuerSettingsInput["bank_account_type"] })}
          className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-ink">
          <option value="">未選択</option>
          <option value="ordinary">普通</option>
          <option value="checking">当座</option>
          <option value="savings">貯蓄</option>
        </select>
      </label>
      {FIELDS.slice(6).map((f) => (
        <Field key={f.key} label={f.label} hint={f.hint} type={f.type} value={values[f.key]} onChange={(v) => setValues({ ...values, [f.key]: v })} disabled={busy} />
      ))}
      <button type="submit" disabled={busy} className="rounded-full bg-[#285B45] px-5 py-2 text-[12.5px] font-bold text-white disabled:opacity-50">
        {busy ? "保存しています…" : "保存する"}
      </button>
      {message && <p className={`text-[12px] ${message.ok ? "text-charcoal" : "text-[#8A2E2E]"}`}>{message.text}</p>}
    </form>
  );
}

function Field(props: { label: string; hint?: string; type?: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <label className="block text-[11px] text-sub">{props.label}
      <input type={props.type ?? "text"} value={props.value} onChange={(e) => props.onChange(e.target.value)} disabled={props.disabled}
        className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-ink" />
      {props.hint && <span className="mt-0.5 block text-[10.5px]">{props.hint}</span>}
    </label>
  );
}
