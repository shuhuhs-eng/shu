import test from "node:test";
import assert from "node:assert/strict";
import { hasAllTwelveAxes } from "../lib/salon-culture/salon-culture-types";

type SalonCultureAxes = Parameters<typeof hasAllTwelveAxes>[0];
import {
  classifyMatchUnavailable,
  findUnusableAxes,
  isStylistSideCause,
  isUsableAxisValue,
  MATCH_STORE_AXIS_KEYS,
  MATCH_STYLIST_AXIS_KEYS,
  MATCH_UNAVAILABLE_MESSAGES,
  resolveStoreTypeState,
  salonSideMatchUnavailableMessage,
  STORE_TYPE_AXIS_KEYS,
} from "../lib/matching/readiness";

const full = (keys: readonly string[], v = 50) => Object.fromEntries(keys.map((k) => [k, v]));

test("軸の値: 0〜100の有限な数値だけが使える（null・文字列・NaN・範囲外は使えない）", () => {
  assert.equal(isUsableAxisValue(0), true);
  assert.equal(isUsableAxisValue(100), true);
  assert.equal(isUsableAxisValue(null), false);
  assert.equal(isUsableAxisValue(undefined), false);
  assert.equal(isUsableAxisValue("50"), false);
  assert.equal(isUsableAxisValue(Number.NaN), false);
  assert.equal(isUsableAxisValue(101), false);
  assert.equal(isUsableAxisValue(-1), false);
});

test("使えない軸: キー欠落・JSON null・文字列・範囲外を区別せず『使えない』として全部拾う", () => {
  const axes = { ...full(MATCH_STORE_AXIS_KEYS), education_support: null, challenge_openness: "x", team_collaboration: 999 };
  delete (axes as Record<string, unknown>).work_flexibility;
  assert.deepEqual(findUnusableAxes(axes, MATCH_STORE_AXIS_KEYS), ["education_support", "challenge_openness", "team_collaboration", "work_flexibility"]);
  assert.deepEqual(findUnusableAxes(null, MATCH_STORE_AXIS_KEYS), [...MATCH_STORE_AXIS_KEYS]);
  assert.deepEqual(findUnusableAxes([1, 2], MATCH_STORE_AXIS_KEYS), [...MATCH_STORE_AXIS_KEYS]);
  assert.deepEqual(findUnusableAxes(full(MATCH_STORE_AXIS_KEYS), MATCH_STORE_AXIS_KEYS), []);
});

test("相性の原因: 美容師の未完了は美容師側、店舗の未確定は店舗側", () => {
  assert.equal(classifyMatchUnavailable({ reason: "stylist_preference_incomplete" }), "stylist_preference_incomplete");
  assert.equal(classifyMatchUnavailable({ reason: "salon_culture_incomplete" }), "store_culture_incomplete");
  assert.equal(isStylistSideCause("stylist_preference_incomplete"), true);
  assert.equal(isStylistSideCause("store_culture_incomplete"), false);
});

test("axes_incomplete: 美容師の8軸が欠けていれば美容師側（店舗側と表示しない）", () => {
  const stylistAxes = { ...full(MATCH_STYLIST_AXIS_KEYS) };
  delete (stylistAxes as Record<string, unknown>).hierarchy_preference;
  const cause = classifyMatchUnavailable({ reason: "axes_incomplete", stylistAxes, storeAxes: full(MATCH_STORE_AXIS_KEYS) });
  assert.equal(cause, "stylist_axes_incomplete");
  assert.equal(isStylistSideCause(cause), true);
  assert.ok(!MATCH_UNAVAILABLE_MESSAGES[cause].includes("店舗"));
});

test("axes_incomplete: 美容師の8軸が使えて店舗が欠ければ店舗側", () => {
  const storeAxes = { ...full(MATCH_STORE_AXIS_KEYS), education_support: null };
  assert.equal(classifyMatchUnavailable({ reason: "axes_incomplete", stylistAxes: full(MATCH_STYLIST_AXIS_KEYS), storeAxes }), "store_axes_incomplete");
  // 一覧のように店舗の軸を持っていなくても、美容師側が使えると分かれば店舗側
  assert.equal(classifyMatchUnavailable({ reason: "axes_incomplete", stylistAxes: full(MATCH_STYLIST_AXIS_KEYS) }), "store_axes_incomplete");
});

test("axes_incomplete: 美容師の軸を取得できない（undefined）ときは店舗側と断定しない", () => {
  assert.equal(classifyMatchUnavailable({ reason: "axes_incomplete" }), "unknown");
  assert.equal(classifyMatchUnavailable({ reason: "axes_incomplete", stylistAxes: undefined, storeAxes: full(MATCH_STORE_AXIS_KEYS) }), "unknown");
  // 店舗の軸が欠けていると分かる場合だけ店舗側
  assert.equal(classifyMatchUnavailable({ reason: "axes_incomplete", storeAxes: { ...full(MATCH_STORE_AXIS_KEYS), work_flexibility: null } }), "store_axes_incomplete");
  // 美容師の行が無い（null）＝全軸が使えない → 美容師側
  assert.equal(classifyMatchUnavailable({ reason: "axes_incomplete", stylistAxes: null }), "stylist_axes_incomplete");
});

test("未知のreason・無いreasonは、どちらの問題とも言わない文言", () => {
  for (const r of ["unknown", "", null, undefined, "something_new"]) {
    const cause = classifyMatchUnavailable({ reason: r });
    assert.equal(cause, "unknown");
    assert.ok(!MATCH_UNAVAILABLE_MESSAGES[cause].includes("店舗"));
    assert.ok(!MATCH_UNAVAILABLE_MESSAGES[cause].includes("あなた"));
  }
});

test("店舗タイプは12軸で判定する。未確定=準備中、確定でも12軸が使えなければ軸不足、そろえば表示可", () => {
  assert.deepEqual(resolveStoreTypeState(null), { state: "preparing" });
  assert.deepEqual(resolveStoreTypeState(undefined), { state: "preparing" });
  assert.deepEqual(resolveStoreTypeState({ culture_axes: full(STORE_TYPE_AXIS_KEYS) }), { state: "ready" });
  // 相性に必要な8軸はそろっているが、タイプ用の4軸が欠けている → 店舗タイプは不足（相性とは別判定）
  const only8 = full(MATCH_STORE_AXIS_KEYS);
  assert.equal(findUnusableAxes(only8, MATCH_STORE_AXIS_KEYS).length, 0);
  const st = resolveStoreTypeState({ culture_axes: only8 });
  assert.equal(st.state, "axes_missing");
  if (st.state === "axes_missing") assert.deepEqual(st.missing, ["technical_specialization", "premium_value", "trend_orientation", "creative_output"]);
  // 値が使えない（文字列）→ 不足
  assert.equal(resolveStoreTypeState({ culture_axes: { ...full(STORE_TYPE_AXIS_KEYS), premium_value: "高い" } }).state, "axes_missing");
  // culture はあるが culture_axes 自体が null
  assert.equal(resolveStoreTypeState({ culture_axes: null }).state, "axes_missing");
});

test("店舗側の画面: 美容師の回答不足を店舗の問題としない", () => {
  assert.ok(salonSideMatchUnavailableMessage("stylist_preference_incomplete").includes("この美容師"));
  assert.ok(salonSideMatchUnavailableMessage("salon_culture_incomplete").includes("この店舗"));
  const neutral = salonSideMatchUnavailableMessage("axes_incomplete");
  assert.ok(!neutral.includes("この店舗") && !neutral.includes("この美容師"));
  assert.equal(salonSideMatchUnavailableMessage(null), neutral);
});

test("軸のキー定義: 相性の店舗8軸は店舗12軸の部分集合、美容師8軸は preference キー", () => {
  for (const k of MATCH_STORE_AXIS_KEYS) assert.ok((STORE_TYPE_AXIS_KEYS as readonly string[]).includes(k), k);
  assert.equal(MATCH_STYLIST_AXIS_KEYS.length, 8);
  assert.equal(STORE_TYPE_AXIS_KEYS.length, 12);
});

test("12軸のキー定義が、既存の hasAllTwelveAxes（タイプ算出の前提）と一致している", () => {
  const all = full(STORE_TYPE_AXIS_KEYS) as SalonCultureAxes;
  assert.equal(hasAllTwelveAxes(all), true);
  for (const k of STORE_TYPE_AXIS_KEYS) {
    const without = { ...all } as Record<string, unknown>;
    delete without[k];
    assert.equal(hasAllTwelveAxes(without as SalonCultureAxes), false, k);
  }
});
