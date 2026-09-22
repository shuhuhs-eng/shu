"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { fullType, type TypeId, type ComputedDiagnosis } from "@/lib/diagnosis";
import { calculateCoreType } from "@/lib/diagnosis/core-types";
import { CORE_TYPE_CONTENT } from "@/lib/diagnosis/core-type-content";
import { TraitScoreBars } from "@/components/diagnosis/trait-score-bars";
import { DIAGNOSIS_RESULT_STORAGE_KEY } from "@/lib/diagnosis-handoff/constants";

type LoadState = "loading" | "none" | ComputedDiagnosis;

/**
 * 診断結果表示（未ログイン・ゲスト用）。app/diagnosis/stylist・app/diagnosis/salon
 * （共通本体: components/diagnosis/diagnosis-quiz.tsx）から sessionStorage経由で
 * 受け取ったcomputeDiagnosis()の結果をそのまま表示する。
 *
 * これは表示専用のプレビューであり、真値は /api/diagnosis/guest が
 * 既にpending_diagnosesへ保存済み（claim_token Cookieも発行済み）。
 * 会員登録・ログインすると、既存のclaimPendingDiagnosisIfPresent()が
 * 自動的にこの診断結果をアカウントへ紐づけ、diagnosis_resultsとして確定保存する。
 *
 * ★美容師診断（mode==="stylist"）のファーストビューを、6才能グラフ先出しから
 * 「8タイプキャラクター→登録CTA」優先の構成に変更した。
 *
 * 8タイププレビューの計算方法（DB保存は一切行わない、表示専用）:
 *   result.scores（computeDiagnosis()が算出した6才能スコア。既存・無変更）
 *   → calculateCoreType(result.scores)（lib/diagnosis/core-types.ts、
 *     DBへ何も書き込まない読み取り専用の既存関数）→ topType(CoreTypeCode)
 *   → CORE_TYPE_CONTENT[topType]（登録後マイページのCoreTypeHeaderと
 *     全く同じ静的データ。name/icon/primaryColor/characterImagePath/
 *     heroHeadline/hiddenTalentを共有し、文言を二重管理しない）
 *
 * 登録後との一致性: calculateCoreType()（TS）とsave_core_type_result()
 * （SQL RPC）は、8タイプ×6軸の重み係数・丸め処理（小数第1位四捨五入）が
 * 完全一致していることを実装前に確認済み。両者とも同じcomputeDiagnosis()
 * が算出した同一の6才能スコアを入力とするため、同じ回答からは登録前
 * プレビューと登録後の正式判定が必ず同じtype codeになる
 * （stylist_core_type_assignments・stylist_core_type_historyへの保存は
 * 登録後のsave_core_type_result()のみが行う。ここでは一切保存しない）。
 *
 * サロン診断（mode==="salon"）には8タイプの概念が無いため、この画面は
 * mode非依存の共通ページのまま、美容師診断の場合のみ新しい構成を表示し、
 * サロン診断は既存の表示（6才能グラフ・市場価値等）を維持する。
 */
export default function DiagnosisResultPage() {
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    const raw = sessionStorage.getItem(DIAGNOSIS_RESULT_STORAGE_KEY);
    if (!raw) {
      setState("none");
      return;
    }
    try {
      setState(JSON.parse(raw) as ComputedDiagnosis);
    } catch {
      setState("none");
    }
  }, []);

  if (state === "loading") {
    return null;
  }

  if (state === "none") {
    return (
      <main className="mx-auto max-w-[520px] px-5 py-16 text-center">
        <p className="text-[14px] text-charcoal">診断結果が見つかりませんでした。</p>
        <Link
          href="/stylist/diagnosis"
          className="mt-4 inline-block text-[13px] font-semibold text-ink underline"
        >
          診断を受け直す
        </Link>
      </main>
    );
  }

  const result = state;
  const isSalon = result.mode === "salon";
  const retakeHref = isSalon ? "/diagnosis/salon" : "/stylist/diagnosis";
  const signupHref = isSalon ? "/signup/salon" : "/signup";

  // ★サロン診断は今回の対象外。既存の表示をそのまま維持する（変更していない）。
  if (isSalon) {
    const type = fullType(result.typeId as TypeId);
    return (
      <main className="mx-auto max-w-[520px] px-5 py-12">
        <div className="mb-7 flex items-center gap-2.5">
          <span className="eyebrow">Beauty Reach</span>
          <hr className="h-px flex-1 border-0 bg-line" />
        </div>

        <p className="eyebrow mb-2">サロン診断結果</p>
        <h1 className="font-serif text-2xl font-bold text-ink">{result.typeName}</h1>
        {type && <p className="mt-2 text-[14px] leading-relaxed text-charcoal">{type.line}</p>}

        <section className="mt-7 rounded-2xl border border-line bg-surface p-6">
          <p className="eyebrow mb-3">6才能スコア</p>
          <TraitScoreBars scores={result.scores} />
        </section>

        {result.marketValueScore != null && (
          <section className="mt-6 rounded-2xl border border-line bg-surface p-6">
            <p className="eyebrow mb-1">市場価値（参考値）</p>
            <p className="font-data text-2xl font-bold text-ink">{result.marketValueScore}</p>
            {result.salaryBand && (
              <p className="mt-1 text-[13px] text-sub">想定年収帯: {result.salaryBand}</p>
            )}
          </section>
        )}

        <div className="mt-8 rounded-2xl border border-line bg-surface2 p-6 text-center">
          <p className="text-[13.5px] leading-relaxed text-charcoal">
            この結果を保存し、美容師とのマッチング精度を高めるには、サロンとしての会員登録が必要です。
          </p>
          <Link
            href={signupHref}
            className="mt-4 flex w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface"
          >
            結果を保存する（サロン新規登録）
          </Link>
          <p className="mt-3 text-[13px] text-sub">
            すでにアカウントをお持ちの方は{" "}
            <Link href="/salon/login" className="underline">
              ログイン
            </Link>
          </p>
          <Link href={retakeHref} className="mt-3 inline-block text-[13px] text-sub underline">
            診断を受け直す
          </Link>
        </div>
      </main>
    );
  }

  // ★ここから美容師診断（mode === "stylist"）の新しいファーストビュー。
  // ★8タイプ判定ロジックは一切変更していない。ここで使うのは既存の
  // calculateCoreType()（読み取り専用・DB書き込みなし）とCORE_TYPE_CONTENT
  // （既存の静的データ）のみで、以下はその表示方法（UI・コピー・表示順）の
  // 調整のみ。
  const classification = calculateCoreType(result.scores);
  const content = CORE_TYPE_CONTENT[classification.topType];

  // ⑤ロック項目をコンパクトに（7項目→6項目、市場価値と想定年収を1項目に統合）。
  const lockedItems = [
    "6つの才能バランス",
    "市場価値・想定年収",
    "あなたの強み",
    "向いている働き方",
    "AIによるあなた専用分析",
    "相性の良いサロン",
  ];

  return (
    <main className="mx-auto max-w-[520px] px-5 py-8">
      <div className="mb-5 flex items-center gap-2.5">
        <span className="eyebrow">Beauty Reach</span>
        <hr className="h-px flex-1 border-0 bg-line" />
      </div>

      {/* ①結果発表（タイプ名より前に必ず表示する）。 */}
      <div className="text-center">
        <h1 className="font-serif text-[20px] font-bold text-ink">30問の診断が完了しました</h1>
        <p className="mt-1.5 text-[13px] text-charcoal">
          あなたの美容師としての才能が見えてきました。
        </p>
      </div>

      {/* ②タイプ名→キャラクター→heroHeadlineを1つの「結果発表」ブロックとして
          視覚的につなげる（登録後マイページのCoreTypeHeaderと同じ
          CORE_TYPE_CONTENTを参照。文言・アイコン・カラー・キャラクター画像は
          二重管理しない。characterImagePath自体は変更していない）。
          スマホでキャラクターがCTAを押し下げすぎないよう、円のサイズは
          控えめ(h-32)にとどめている。 */}
      <div className="mt-6 flex flex-col items-center text-center">
        <p className="eyebrow text-sub">あなたの才能タイプは</p>
        <h2
          className="mt-2 flex items-center justify-center gap-2 font-serif text-[26px] font-bold leading-tight"
          style={{ color: content.primaryColor }}
        >
          <span aria-hidden="true">{content.icon}</span>
          {content.name}
        </h2>

        <div className="relative mt-3 h-40 w-40">
          <div className="absolute inset-0 rounded-full bg-gradient-to-b from-[var(--gold)]/15 to-transparent blur-xl" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={content.characterImagePath}
            alt={content.name}
            className="relative h-full w-full object-contain drop-shadow-sm"
          />
        </div>

        <p className="mt-4 max-w-[280px] text-[15px] font-semibold leading-relaxed text-ink">
          {content.heroHeadline.split("\n").map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
        </p>
        <p className="mt-2.5 max-w-[280px] text-[13px] leading-relaxed text-charcoal">
          {content.hiddenTalent}
        </p>
      </div>

      {/* ④登録したくなる「続き」。3つの問いで興味を強める
          （heroHeadline/hiddenTalentの文言自体は変更していない）。 */}
      <div className="mt-6 text-center">
        <p className="text-[13px] font-semibold text-ink">
          でも、これはあなたの診断結果のほんの一部。
        </p>
        <ul className="mt-4 space-y-2.5">
          <li className="flex items-start justify-center gap-1.5 text-[14px] font-semibold leading-snug text-ink">
            <span aria-hidden="true" style={{ color: "var(--gold)" }}>→</span>
            あなたの市場価値は？
          </li>
          <li className="flex items-start justify-center gap-1.5 text-[14px] font-semibold leading-snug text-ink">
            <span aria-hidden="true" style={{ color: "var(--gold)" }}>→</span>
            どんなサロンなら、もっと才能を活かせる？
          </li>
          <li className="flex items-start justify-center gap-1.5 text-[14px] font-semibold leading-snug text-ink">
            <span aria-hidden="true" style={{ color: "var(--gold)" }}>→</span>
            あなたの可能性をAIはどう分析する？
          </li>
        </ul>
      </div>

      {/* ⑤登録後に見られる内容。コンパクトな2列グリッドにし、
          padding・行間を抑えてスマホで縦に伸びすぎないようにする。 */}
      <ul className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2 rounded-2xl border border-line bg-surface p-4">
        {lockedItems.map((label) => (
          <li key={label} className="flex items-start gap-1.5 text-[12px] leading-snug text-charcoal">
            <span aria-hidden="true">🔒</span>
            <span>
              {label}
              {label === "相性の良いサロン" && (
                <span className="ml-1 text-[10px] text-sub">(Coming Soon)</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      {/* ⑥メインCTA。ロック一覧の直後に配置し、できるだけ早く到達できるように
          する。登録導線・claim_token Cookieに関わる処理は変更していない
          （既存のsignupHrefへのリンクのみ）。 */}
      <Link
        href={signupHref}
        className="mt-5 flex w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface"
      >
        無料登録して診断結果をすべて見る
      </Link>
      <p className="mt-2 text-center text-[11.5px] text-sub">登録は無料・約1分</p>

      {/* ログイン導線 */}
      <p className="mt-3 text-center text-[13px] text-sub">
        すでにアカウントをお持ちの方は{" "}
        <Link href="/stylist/login" className="underline">
          ログイン
        </Link>
      </p>
      <p className="mt-3 text-center">
        <Link href={retakeHref} className="text-[13px] text-sub underline">
          診断を受け直す
        </Link>
      </p>
    </main>
  );
}
