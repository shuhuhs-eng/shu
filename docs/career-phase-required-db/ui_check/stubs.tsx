import { parseCareerPhaseInput } from "/home/claude/shu/lib/student-diagnosis/career-phase";
export const useRouter = () => ({ push: (u: string) => { (window as any).__pushed = u; }, refresh: () => { (window as any).__refresh?.(); } });
// 反映ボタンの確認用（モック。実Supabaseではない）: 呼び出しを記録し、保存済みの値（__values）だけを更新する
export const applyValuePrioritiesAction = async (values: string[]) => {
  const w = window as any; (w.__apply ||= []).push(values); await new Promise((r) => setTimeout(r, 120));
  if (w.__mode === "fail") return { ok: false, message: "反映に失敗しました。通信状況を確認して、もう一度お試しください。" };
  w.__values = values; return { ok: true };
};
export const saveProfileAction = async (_p: any, fd: FormData) => {
  const w = window as any; const obj: Record<string, string[]> = {};
  for (const [k, v] of fd.entries()) (obj[k] ||= []).push(String(v));
  w.__calls.push(obj);
  await new Promise((r) => setTimeout(r, 120));
  if (w.__mode === "fail") return { error: "保存に失敗しました。しばらくしてから再度お試しください。" };
  // サーバー側の検証（実物と同じ規則: lib の parseCareerPhaseInput を使う）を模す
  const cp = parseCareerPhaseInput({ phase: obj.careerPhase?.[0], graduationYear: obj.graduationYear?.[0], graduationMonth: obj.graduationMonth?.[0], blankPeriodValue: obj.blankPeriodValue?.[0], blankPeriodUnit: obj.blankPeriodUnit?.[0] });
  if (!cp.ok) { const fe: any = {}; if (cp.errors.phase) fe.careerPhase = [cp.errors.phase]; if (cp.errors.graduationYm) fe.graduationYm = [cp.errors.graduationYm]; if (cp.errors.blankPeriod) fe.blankPeriod = [cp.errors.blankPeriod]; return { error: "入力内容をご確認ください。", fieldErrors: fe }; }
  w.__saved = obj; w.__persist?.(obj); return { success: "プロフィールを保存しました。" };
};
export const AvatarUploader = () => null;
