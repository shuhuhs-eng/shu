"use client";

import { useEffect, useState } from "react";
import Link, { useLinkStatus } from "next/link";
import type { ComputedDiagnosis } from "@/lib/diagnosis";
import { calculateCoreType } from "@/lib/diagnosis/core-types";
import { CORE_TYPE_CONTENT } from "@/lib/diagnosis/core-type-content";
import { DIAGNOSIS_RESULT_STORAGE_KEY, DIAGNOSIS_SAVED_STORAGE_KEY } from "@/lib/diagnosis-handoff/constants";
import { createClient } from "@/lib/supabase/client";

type LoadState = "loading" | "none" | ComputedDiagnosis;

/**
 * 診断結果表示（未ログイン・ゲスト用）。app/diagnosis/stylist・app/diagnosis/salon
 * （共通本体: components/diagnosis/diagnosis-quiz.tsx）から sessionStorage経由で
 * 受け取ったcomputeDiagnosis()の結果をそのまま表示する。
 *
 * これは表示専用のプレビューであり、真値は /api/diagnosis/guest が
 * 既にpending_diagnosesへ保存済み（claim_token Cookieも発行済み）。
 * 「新規会員登録」した場合だけ、その新しいアカウントの初回結果として引き継ぎ（claimPendingDiagnosisForNewAccount。
 * サーバー側で新規作成されたアカウントであることを確認した場合のみ）、diagnosis_resultsとして確定保存する。
 * 既存アカウントへのログインでは、この結果は保存されない（保存済みの診断結果は変わらない）。
 * 既存会員が結果を更新したいときは、ログイン中に「診断を受け直す」から回答する。
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
/** 遷移中（クリック直後〜次の画面が出るまで）は処理中と分かる表示にする。 */
function PendingLabel({ children, pendingText }: { children: React.ReactNode; pendingText: string }) {
  const { pending } = useLinkStatus();
  return <>{pending ? pendingText : children}</>;
}

/** ログイン中の本人向け。登録・ログインの案内は出さず、保存結果の確認先（マイページ）だけを案内する。 */
function MemberResultNotice({ saved, mypageHref, retakeHref }: { saved: boolean; mypageHref: string; retakeHref: string }) {
  return (
    <div className="mt-8 rounded-2xl border border-line bg-surface2 p-6 text-center">
      <p className="text-[13.5px] leading-relaxed text-charcoal">
        {saved
          ? "今回の診断結果をあなたのアカウントに保存しました。"
          : "この結果は、あなたのアカウントには保存されていません。保存済みの診断結果は、マイページで確認できます。"}
      </p>
      <Link
        href={mypageHref}
        prefetch={false}
        onClick={(e) => {
          // 遷移中の連打を防ぐ（二重にナビゲーションを開始しない）。
          if (e.currentTarget.getAttribute("aria-busy") === "true") {
            e.preventDefault();
            return;
          }
          e.currentTarget.setAttribute("aria-busy", "true");
        }}
        className="mt-4 flex w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface aria-busy:opacity-60"
      >
        <PendingLabel pendingText="マイページを開いています...">マイページで結果を見る</PendingLabel>
      </Link>
      <Link href={retakeHref} className="mt-1 inline-flex min-h-[44px] items-center text-[13px] text-sub underline">
        診断を受け直す
      </Link>
      {!saved && (
        <p className="mt-2 text-[12px] leading-relaxed text-sub">
          ログイン中に「診断を受け直す」から回答すると、その結果があなたのアカウントに保存されます。
        </p>
      )}
    </div>
  );
}

export default function DiagnosisResultPage() {
  const [state, setState] = useState<LoadState>("loading");
  // ログイン状態（表示の出し分け専用。保存の可否はサーバー側が判断する）。
  const [auth, setAuth] = useState<"checking" | "member" | "guest">("checking");
  const [saved, setSaved] = useState(false);

  // 「保存済み」の印は、診断クイズがサーバー保存の成功を確認した後にだけ書く（保存前・失敗時は書かない）。
  // 印がある場合は追加の通信なしで即座にログイン中の表示にする（以前は結果表示のたびに認証サーバーへの
  // 往復を待っていた）。印が無い場合はゲスト表示のまま、ログイン中かどうかを裏で確認して切り替える。
  useEffect(() => {
    let cancelled = false;
    let hasSaved = false;
    try {
      hasSaved = !!sessionStorage.getItem(DIAGNOSIS_SAVED_STORAGE_KEY);
    } catch {
      // sessionStorageが使えない場合は「保存済み」を表示しない。
    }
    Promise.resolve().then(() => {
      if (cancelled) return;
      setSaved(hasSaved);
      setAuth(hasSaved ? "member" : "guest");
    });
    if (!hasSaved) {
      Promise.resolve()
        .then(async () => {
          const { data } = await createClient().auth.getUser();
          return !!data.user;
        })
        .catch(() => false)
        .then((member) => {
          if (!cancelled && member) setAuth("member");
        });
    }
    return () => {
      cancelled = true;
    };
  }, []);

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

  if (state === "loading" || auth === "checking") {
    return null;
  }
  const isMember = auth === "member";

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
  const retakeHref = "/stylist/diagnosis";
  const signupHref = isSalon ? "/signup/salon" : "/signup";

  // ★サロン診断（mode==="salon"）: 14問の6軸スコア・美容師向け12タイプ名・説明は表示しない。
  // （数値が能力の点数に見えるため、また美容師向けの名称がサロンに合わないため。回答・保存・計算は変更していない。）
  // サロンの方針・環境は、既存の「サロンらしさ」診断（/salon/culture）の5軸で確認する。
  if (isSalon) {
    return (
      <main className="mx-auto max-w-[520px] px-5 py-12">
        <div className="mb-7 flex items-center gap-2.5">
          <span className="eyebrow">Beauty Reach</span>
          <hr className="h-px flex-1 border-0 bg-line" />
        </div>

        <p className="eyebrow mb-2">サロン診断</p>
        <h1 className="font-serif text-2xl font-bold text-ink">サロンの方針・環境は「サロンらしさ」で確認できます</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-charcoal">
          「サロンらしさ」に回答すると、育て方・新しい挑戦・発信・チーム・働き方の5つについて、サロンの方針・環境が5段階のバランスで分かります。優劣を示すものではありません。
        </p>

        {isMember ? (
          <div className="mt-8 rounded-2xl border border-line bg-surface2 p-6 text-center">
            <p className="text-[13.5px] leading-relaxed text-charcoal">
              {saved ? "今回の診断の回答をあなたのアカウントに保存しました。" : "この結果は、あなたのアカウントには保存されていません。"}
            </p>
            <Link
              href="/salon/mypage"
              prefetch={false}
              className="mt-4 flex w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface"
            >
              マイページで「サロンらしさ」を見る
            </Link>
            <Link href="/salon/culture" className="mt-1 inline-flex min-h-[44px] items-center text-[13px] text-sub underline">
              サロンらしさを回答する・更新する
            </Link>
          </div>
        ) : (
          <div className="mt-8 rounded-2xl border border-line bg-surface2 p-6 text-center">
            <p className="text-[13.5px] leading-relaxed text-charcoal">
              サロンとして会員登録すると、「サロンらしさ」に回答して、美容師とのマッチングに活用できます。
            </p>
            <Link
              href={signupHref}
              className="mt-4 flex w-full items-center justify-center rounded-full bg-ink px-6 py-4 text-[15px] font-semibold text-surface"
            >
              サロン新規登録
            </Link>
            <p className="mt-3 text-[13px] text-sub">
              すでにアカウントをお持ちの方は{" "}
              <Link href="/salon/login" className="underline">
                ログイン
              </Link>
            </p>
          </div>
        )}
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

      {isMember ? (
        <MemberResultNotice saved={saved} mypageHref="/stylist/mypage" retakeHref={retakeHref} />
      ) : (
        <>
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
        すでに会員の方は{" "}
        <Link href="/stylist/login?next=/stylist/mypage" className="inline-flex min-h-[44px] items-center px-2 underline">
          ログイン
        </Link>
      </p>
      <p className="mt-1 text-center text-[11.5px] leading-relaxed text-sub">
        ログインしても、今回の結果は保存されません。保存済みの結果はマイページで確認できます（更新するには、ログイン後に診断を受け直してください）。
      </p>
      <p className="mt-3 text-center">
        <Link href={retakeHref} className="inline-flex min-h-[44px] items-center text-[13px] text-sub underline">
          診断を受け直す
        </Link>
      </p>
        </>
      )}
    </main>
  );
}
