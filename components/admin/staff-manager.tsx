"use client";

import { useActionState, useState } from "react";
import { inviteStaffAction, resumeInviteAction, renameStaffAction, resendStaffAction, setStaffStatusAction, staffPasswordResetAction, type ManageState } from "@/app/admin/staff-members/actions";
import { staffView, type OpenInvitation, type StaffRow } from "@/lib/admin/staff-admin";

const btn = "min-h-[44px] rounded-full border border-line bg-surface px-4 text-[13px] font-semibold text-charcoal disabled:opacity-50";
function Msg({ s }: { s: ManageState }) {
  if (!s) return null;
  return <p role={s.ok ? "status" : "alert"} className="mt-2 rounded-xl border border-line bg-surface2 px-3 py-2 text-[12.5px] text-charcoal">{s.message}</p>;
}

function InviteForm() {
  // 同じ招待の再試行・二重クリックは同じ requestId（DB側で二重登録されない）。区切りがついたら新しい requestId。
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  // 入力欄は制御コンポーネントにする（フォーム送信後の自動リセットで、失敗時に入力が消えないように）。
  const [name, setName] = useState(""), [email, setEmail] = useState("");
  const [s, action, pending] = useActionState(async (prev: ManageState, fd: FormData) => {
    const r = await inviteStaffAction(prev, fd);
    if (r?.settled) setRequestId(crypto.randomUUID());
    if (r?.clear) { setName(""); setEmail(""); }
    return r;
  }, null);
  return (
    <form action={action} className="mt-4 grid gap-3 rounded-2xl border border-line bg-surface p-4">
      <h2 className="text-[15px] font-semibold text-charcoal">スタッフを招待</h2>
      <input type="hidden" name="requestId" value={requestId} />
      <label className="grid gap-1 text-[13px] text-charcoal">名前（1〜60文字）<input name="displayName" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className="min-h-[44px] rounded-xl border border-line px-3" /></label>
      <label className="grid gap-1 text-[13px] text-charcoal">メールアドレス<input name="email" type="email" required autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className="min-h-[44px] rounded-xl border border-line px-3" /></label>
      <button type="submit" disabled={pending} className="min-h-[44px] rounded-full bg-charcoal px-6 text-[14px] font-semibold text-white disabled:opacity-50">{pending ? "処理中…" : "招待メールを送る"}</button>
      <Msg s={s} />
    </form>
  );
}

function OpenRow({ o }: { o: OpenInvitation }) {
  const [s, action, pending] = useActionState(resumeInviteAction, null);
  return (
    <li className="rounded-xl border border-line bg-surface2 px-3 py-2 text-[12.5px] text-charcoal">
      {o.display_name}／{o.email}／{o.status}
      <form action={action} className="mt-2">
        <input type="hidden" name="requestId" value={o.request_id} /><input type="hidden" name="email" value={o.email} /><input type="hidden" name="displayName" value={o.display_name} />
        <button className={btn} disabled={pending}>続きから進める</button>
      </form>
      <Msg s={s} />
    </li>
  );
}

function Row({ r, nowIso }: { r: StaffRow; nowIso: string }) {
  const v = staffView(r, new Date(nowIso));
  const [rs, resend, rp] = useActionState(resendStaffAction, null);
  const [ns, rename, np] = useActionState(renameStaffAction, null);
  const [ss, setStatus, sp] = useActionState(setStaffStatusAction, null);
  const [ps, reset, pp] = useActionState(staffPasswordResetAction, null);
  return (
    <li className="rounded-2xl border border-line bg-surface p-4" data-testid={`staff-${r.email}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[15px] font-semibold text-charcoal">{r.display_name}</span>
        <span className="text-[12px] text-charcoal" data-status={v.key}>{v.label}</span>
      </div>
      <p className="mt-1 text-[12.5px] text-charcoal">{r.email}</p>
      {v.expiresAt && <p className="text-[12px] text-charcoal">招待の期限: {v.expiresAt.slice(0, 10)}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {v.actions.includes("resend") && (
          <form action={resend}><input type="hidden" name="userId" value={r.user_id} /><button className={btn} disabled={rp}>再招待</button></form>
        )}
        {v.actions.includes("password_reset") && (
          <form action={reset}><input type="hidden" name="userId" value={r.user_id} /><button className={btn} disabled={pp}>パスワード再設定を送る</button></form>
        )}
        {v.actions.includes("suspend") && (
          <form action={setStatus} onSubmit={(e) => { if (!window.confirm("このスタッフを停止します。招待中の場合も、届いている招待リンクは使えなくなります。アカウントと履歴は消えません。よろしいですか？")) e.preventDefault(); }}>
            <input type="hidden" name="userId" value={r.user_id} /><input type="hidden" name="status" value="suspended" /><button className={btn} disabled={sp}>停止</button>
          </form>
        )}
        {v.actions.includes("reactivate") && (
          <form action={setStatus}><input type="hidden" name="userId" value={r.user_id} /><input type="hidden" name="status" value="active" /><button className={btn} disabled={sp}>再開</button></form>
        )}
      </div>
      <form action={rename} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="userId" value={r.user_id} />
        <label className="grid gap-1 text-[12px] text-charcoal">名前の変更<input name="displayName" defaultValue={r.display_name} required maxLength={60} className="min-h-[44px] rounded-xl border border-line px-3" /></label>
        <button className={btn} disabled={np}>変更</button>
      </form>
      <Msg s={rs} /><Msg s={ps} /><Msg s={ss} /><Msg s={ns} />
    </li>
  );
}

export function StaffManager({ staff, open, nowIso }: { staff: StaffRow[]; open: OpenInvitation[]; nowIso: string }) {
  return (
    <div>
      <InviteForm />
      <h2 className="mt-8 text-[15px] font-semibold text-charcoal">スタッフ一覧</h2>
      {staff.length === 0 ? <p className="mt-2 text-[13px] text-charcoal">まだスタッフはいません。</p> : (
        <ul className="mt-3 grid gap-3">{staff.map((r) => <Row key={r.user_id} r={r} nowIso={nowIso} />)}</ul>
      )}
      {open.length > 0 && (
        <section className="mt-8" aria-label="進行中の招待">
          <h2 className="text-[15px] font-semibold text-charcoal">進行中の招待（登録が完了していないもの）</h2>
          <p className="mt-1 text-[12px] text-charcoal">途中で止まった招待です。「続きから進める」で再開できます（二重に作られません）。</p>
          <ul className="mt-2 grid gap-2">{open.map((o) => <OpenRow key={o.request_id} o={o} />)}</ul>
        </section>
      )}
    </div>
  );
}
