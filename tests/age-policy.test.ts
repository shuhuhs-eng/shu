import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { profileFormSchema } from "@/lib/validation/profile";
import { ageOn, decadeOf, formatAgeLabel, isAgeDisplayMode, validateBirthDate } from "@/lib/profile/birth-date";
import { fetchPublicStylistsForScout } from "@/lib/scouts/public-stylists";
import { AgeDisplayModeField } from "@/components/profile/age-display-mode-field";
import { BirthDateField } from "@/components/profile/birth-date-field";
import { AgeRequestControl } from "@/components/age-disclosure/age-request-control";
import { AgeRequestCard } from "@/components/age-disclosure/age-request-card";
import { StylistPublicView } from "@/components/profile/stylist-public-view";

const valid = {
  publicName: "さくら", prefecture: "東京都", experienceYears: "3", specialties: ["カット"], employmentType: "full_time",
  jobChangeIntent: "passive", snsLinks: [], fullName: "山田 花子", ageBand: "30_34", gender: "female",
  valuePriorities: ["work_life_balance", "skill_growth", "income_stability"], visibility: "PRIVATE",
};
const parse = (extra: Record<string, unknown>) => profileFormSchema.safeParse({ ...valid, ...extra });
function fieldError(extra: Record<string, unknown>, key: string): string | undefined {
  const r = parse(extra);
  if (r.success) return undefined;
  return r.error.flatten().fieldErrors[key as never]?.[0];
}

test("生年月日: 項目があるのに空なら必須エラー（登録済みを空にして未登録に戻せない）", () => {
  assert.equal(fieldError({ birthDate: "" }, "birthDate"), "生年月日を入力してください");
  assert.equal(fieldError({ birthDate: "   " }, "birthDate"), "生年月日を入力してください");
});

test("生年月日: 項目が無い(undefined)のはDB未対応のときだけ。検査せず通る（最終防衛はDBのトリガー）", () => {
  const r = parse({});
  assert.ok(r.success || !("birthDate" in r.error.flatten().fieldErrors));
});

test("生年月日: 範囲は従来のまま（満15歳以上100歳以下・未来日不可）", () => {
  const today = "2026-11-15";
  assert.equal(validateBirthDate("2011-11-15", today), null); // ちょうど満15歳
  assert.ok(validateBirthDate("2011-11-16", today)); // 満14歳
  assert.equal(validateBirthDate("1926-11-15", today), null); // ちょうど満100歳
  assert.ok(validateBirthDate("1925-11-14", today)); // 満101歳
  assert.ok(validateBirthDate("2026-11-16", today)); // 未来
  assert.ok(validateBirthDate("2000-02-30", today)); // 実在しない日付
});

test("年齢の表示方法: exact / decade のみ。それ以外・空は選択エラー", () => {
  assert.equal(fieldError({ ageDisplayMode: "" }, "ageDisplayMode"), "年齢の表示方法を選択してください");
  assert.equal(fieldError({ ageDisplayMode: "both" }, "ageDisplayMode"), "年齢の表示方法を選択してください");
  for (const m of ["exact", "decade"]) {
    const r = parse({ birthDate: "1990-01-01", ageDisplayMode: m });
    assert.ok(r.success, JSON.stringify(!r.success && r.error.flatten()));
    if (r.success) assert.equal(r.data.ageDisplayMode, m);
  }
  assert.ok(isAgeDisplayMode("exact") && isAgeDisplayMode("decade") && !isAgeDisplayMode("") && !isAgeDisplayMode(null));
});

test("満年齢と年代: 誕生日の前日までは上がらない。年代は10の位", () => {
  assert.equal(ageOn("1990-11-15", "2026-11-15"), 36); // 誕生日当日
  assert.equal(ageOn("1990-11-16", "2026-11-15"), 35); // 前日まで
  assert.equal(decadeOf(36), 30);
  assert.equal(decadeOf(40), 40);
  assert.equal(decadeOf(19), 10);
});

test("年齢表記: 実年齢が許可されていれば「45歳」、年代だけなら「40代」、どちらも無ければnull（推測しない）", () => {
  assert.equal(formatAgeLabel({ age: 45, age_decade: 40 }), "45歳");
  assert.equal(formatAgeLabel({ age_decade: 40 }), "40代");
  assert.equal(formatAgeLabel({}), null);
  assert.equal(formatAgeLabel({ age: undefined, age_decade: undefined }), null);
});

test("入力欄: 生年月日は必須。表示方法は未選択のとき、どれにもチェックが入らない（既存会員を勝手に実年齢にしない）", () => {
  const birth = renderToStaticMarkup(createElement(BirthDateField, { defaultValue: "" }));
  assert.match(birth, /required/);
  assert.ok(!birth.includes("任意"));
  const none = renderToStaticMarkup(createElement(AgeDisplayModeField, { defaultValue: "" }));
  assert.ok(!/checked/.test(none));
  assert.match(none, /45歳/);
  assert.match(none, /40代/);
  assert.match(none, /選択するまで、サロン向けの一覧には表示されません/);
  const exact = renderToStaticMarkup(createElement(AgeDisplayModeField, { defaultValue: "exact" }));
  assert.equal((exact.match(/checked/g) ?? []).length, 1);
  assert.match(exact, /value="exact"[^>]*checked|checked[^>]*value="exact"/);
});

test("開示依頼ボタン: 年代表示で未依頼のときだけ依頼できる。実年齢表示・公開されない人・未対応には出ない", () => {
  const props = { storeId: "00000000-0000-0000-0000-0000000000b0", stylistUserId: "00000000-0000-0000-0000-000000000201" };
  const render = (status: Parameters<typeof AgeRequestControl>[0]["status"], extra = {}) => renderToStaticMarkup(createElement(AgeRequestControl, { ...props, status, ...extra }));
  assert.match(render("none"), /実年齢の開示を依頼/);
  assert.match(render("none"), /任意/);
  assert.match(render("pending"), /回答待ち/);
  assert.ok(!/実年齢の開示を依頼<\/button>/.test(render("pending")));
  assert.match(render("approved"), /承認されています/);
  assert.match(render("declined"), /辞退されました/);
  assert.ok(!/<button/.test(render("declined")));
  assert.equal(render("not_needed"), "");
  assert.equal(render("unavailable"), "");
  assert.equal(render(undefined), "");
  assert.match(render("none", { recruitingPaused: true }), /disabled/);
});

test("美容師の承認画面: 回答待ちだけ承認・辞退のボタン。回答済みは変更不可。生年月日は出ない", () => {
  const base = { requestId: "00000000-0000-0000-0000-0000000000d1", storeName: "渋谷店", location: "東京都 渋谷区", requestedAt: "2026-11-01T00:00:00Z" };
  const pending = renderToStaticMarkup(createElement(AgeRequestCard, { ...base, decidedAt: null, status: "pending" }));
  assert.match(pending, /承認する/);
  assert.match(pending, /辞退する/);
  assert.match(pending, /渋谷店/);
  assert.match(pending, /生年月日は公開されません/);
  const done = renderToStaticMarkup(createElement(AgeRequestCard, { ...base, decidedAt: "2026-11-02T00:00:00Z", status: "approved" }));
  assert.ok(!/承認する|辞退する/.test(done));
  assert.match(done, /変更できません/);
});

test("サロン向け表示: 年代表示は「40代」・実年齢は「45歳」。生年月日の語は出ない", () => {
  const base = { publicName: "さくら", prefecture: "東京都", currentPosition: null, experienceYears: 3, desiredWorkLocation: null, jobChangeIntent: "active" as const, specialties: [], bio: null, extended: true };
  const dec = renderToStaticMarkup(createElement(StylistPublicView, { data: { ...base, ageLabel: formatAgeLabel({ age_decade: 40 }) } }));
  const ex = renderToStaticMarkup(createElement(StylistPublicView, { data: { ...base, ageLabel: formatAgeLabel({ age: 45, age_decade: 40 }) } }));
  assert.match(dec, /40代/);
  assert.ok(!/45歳/.test(dec));
  assert.match(ex, /45歳/);
  assert.ok(!/生年月日/.test(dec + ex));
});

test("候補一覧の取得: 0070未適用のDB（PGRST202）では従来の引数なしへ戻す。それ以外のエラーは戻さない", async () => {
  const calls: Array<unknown> = [];
  const make = (firstError: { code: string; message: string } | null) =>
    ({
      rpc: async (name: string, args?: unknown) => {
        calls.push([name, args]);
        if (args && firstError) return { data: null, error: firstError };
        return { data: [], error: null };
      },
    }) as never;
  const r1 = await fetchPublicStylistsForScout(make({ code: "PGRST202", message: "no function" }), "s1");
  assert.equal(r1.error, null);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ["get_public_stylists_for_scout", { p_store_id: "s1" }]);
  assert.deepEqual(calls[1], ["get_public_stylists_for_scout", undefined]);
  calls.length = 0;
  const r2 = await fetchPublicStylistsForScout(make({ code: "42501", message: "store not found or not accessible" }), "s1");
  assert.ok(r2.error);
  assert.equal(calls.length, 1); // 権限エラーなどは、引数なしで取り直さない（他店舗の情報を取得しない）
});
