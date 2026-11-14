/**
 * AI解説の文章を、画面で読みやすい長さに分けるだけの表示用ヘルパー（文章そのものは変更しない）。
 * 先頭から「。」区切りで、最大 maxChars 文字までを lead、残りを rest にする。必ず lead は1文以上を含める。
 */
export function splitLead(text: string, maxChars = 80): { lead: string; rest: string } {
  const t = text.trim();
  if (t.length <= maxChars) return { lead: t, rest: "" };
  const sentences = t.match(/[^。！？!?]+[。！？!?]?/g) ?? [t];
  let lead = "";
  let used = 0;
  for (const s of sentences) {
    if (used > 0 && (lead + s).length > maxChars) break;
    lead += s;
    used += 1;
  }
  return { lead: lead.trim(), rest: t.slice(lead.length).trim() };
}

/** 「次の一手」の各項目を、見出し（最初の一文）と補足（残り）に分ける。 */
export function splitStep(text: string): { title: string; detail: string } {
  const t = text.trim();
  const first = t.match(/^[^。！？!?]+[。！？!?]?/)?.[0] ?? t;
  return { title: first.trim(), detail: t.slice(first.length).trim() };
}
