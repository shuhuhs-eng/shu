"use client";

import { useState } from "react";
import { saveBillingProfileAction } from "@/lib/invoices/actions";

export type BillingProfileValues = {
  legal_name: string; postal_code: string; address: string;
  department_name: string; contact_name: string; billing_email: string;
};

const FIELDS: Array<{ key: keyof BillingProfileValues; label: string; required?: boolean; hint?: string; type?: string }> = [
  { key: "legal_name", label: "請求先の正式名称", required: true, hint: "請求書の宛名になります（例：株式会社〇〇）" },
  { key: "postal_code", label: "郵便番号", required: true, hint: "例：530-0001" },
  { key: "address", label: "住所", required: true },
  { key: "department_name", label: "部署" },
  { key: "contact_name", label: "ご担当者" },
  { key: "billing_email", label: "請求先メールアドレス", type: "email" },
];

/** 会社の請求先の編集（company_owner / company_admin）。権限はDBでも確認される。 */
export function BillingProfileForm({ organizationId, initial }: { organizationId: string; initial: BillingProfileValues }) {
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const result = await saveBillingProfileAction({ organizationId, ...values });
    setBusy(false);
    setMessage(result.success ? { ok: true, text: result.message } : { ok: false, text: result.error });
  }

  return (
    <form onSubmit={save} className="mt-4 space-y-3">
      {FIELDS.map((f) => (
        <label key={f.key} className="block text-[11px] text-sub">{f.label}{f.required && <span className="ml-1 text-[#8A2E2E]">必須</span>}
          <input type={f.type ?? "text"} value={values[f.key]} disabled={busy}
            onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
            className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-[13px] text-ink" />
          {f.hint && <span className="mt-0.5 block text-[10.5px]">{f.hint}</span>}
        </label>
      ))}
      <button type="submit" disabled={busy} className="rounded-full bg-[#285B45] px-5 py-2 text-[12.5px] font-bold text-white disabled:opacity-50">
        {busy ? "保存しています…" : "保存する"}
      </button>
      {message && <p className={`text-[12px] ${message.ok ? "text-charcoal" : "text-[#8A2E2E]"}`}>{message.text}</p>}
    </form>
  );
}
