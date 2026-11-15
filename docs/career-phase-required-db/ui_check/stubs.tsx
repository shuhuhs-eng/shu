export const useRouter = () => ({ push: (u: string) => { (window as any).__pushed = u; } });
export const saveProfileAction = async (_p: any, fd: FormData) => {
  const w = window as any; const obj: Record<string, string[]> = {};
  for (const [k, v] of fd.entries()) (obj[k] ||= []).push(String(v));
  w.__calls.push(obj);
  await new Promise((r) => setTimeout(r, 120));
  if (w.__mode === "fail") return { error: "保存に失敗しました。しばらくしてから再度お試しください。" };
  // サーバー側の必須検証（実物と同じ規則）を模す
  if (!obj.careerPhase) return { error: "入力内容をご確認ください。", fieldErrors: { careerPhase: ["いまの立場を選んでください。"] } };
  w.__saved = obj; return { success: "プロフィールを保存しました。" };
};
export const AvatarUploader = () => null;
