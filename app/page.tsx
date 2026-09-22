import Link from "next/link";
import { ArrowRight, ListChecks, BarChart3, Heart, UserRound, Store, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getUserRole } from "@/lib/auth/user-roles";
import { signOutAction } from "@/lib/auth/actions";
import { SubmitButton } from "@/components/auth/submit-button";
import { HeroCharacter } from "@/components/home/hero-character";

/**
 * 「/」は常にBeauty Reachの一般TOPページを表示する（ログイン状態に関係なく）。
 *
 * ★変更点: 以前はログイン済みユーザーを「/」から user_roles を見て
 * /stylist/mypage・/salon/mypage へ自動リダイレクトしていた。これだと
 * 各マイページの「HOME」リンクを押しても「/」→即マイページへ戻され、
 * 本当のTOPページへ戻れなかった。今回、この自動リダイレクトを廃止し、
 * 「/」は常にTOPを表示するようにした。ログイン済みの場合は、TOP上部に
 * 小さく「◯◯マイページへ」ボタン（登録済みroleの分だけ）とログアウトを
 * 添える（TOP自体のデザインは変更しない）。
 *
 * ログイン後のrole別リダイレクト（/stylist/login→/stylist/mypage、
 * /salon/login→/salon/mypage）は lib/auth/actions.ts 側の
 * determineRoleEntryPath のままで、今回変更していない。
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ★「1 auth user = 1 role」方針: getUserRoles()（複数role時代のSet方式）
  // ではなく、単一roleを返すgetUserRole()を使う。DB側にもuser_roles.user_idの
  // unique制約を追加済み（0008_user_roles_single_role.sql）だが、アプリ側の
  // ロジックでも「同時に両方trueにはならない」ことを構造的に保証するため、
  // hasStylist/hasSalonをこの単一role値から導出する（以降のJSX・デザインは
  // 一切変更していない）。
  const role = user ? await getUserRole(supabase, user.id) : null;
  const hasStylist = role === "stylist";
  const hasSalon = role === "salon";

  // ★確定デザイン仕様（Claude指示用.png）に忠実に実装した一般TOP。
  // ★レスポンシブ: lg（1024px）以上はブランド訴求(左)＋キャラクター領域(右)の
  // 2カラムHero、それ未満は縦1カラム（ロゴ→キャラクター領域→見出し→説明→
  // CTA→3メリット→美容師カード→サロンカードの順）。
  // ★PC版レイアウト修正（今回の対象）。左寄り・右側の巨大な空白BOX・
  // カード見切れ・ロゴ過大を解消する。機能・ログイン処理は上部のまま
  // 一切変更していない。
  //
  // Heroキャラクター: PC画面右側の空きスペースへ配置する想定パス。
  // このファイルがまだ public/images/ に存在しなくても、HeroCharacter
  // コンポーネントが読み込み失敗を検知して自動的に何も描画しないため、
  // ページ全体がエラーになることはない。画像を配置すれば自動的に表示される。
  // 左側コンテンツ（ロゴ・見出し・CTA・3メリット・下部カード）の幅・
  // margin・高さには一切影響しないよう、position: absolute で重ねて
  // 配置する（PCのみ。スマホ表示は次工程で調整するため今回は対象外）。
  const HERO_CHARACTER_SRC: string | null = "/images/beauty-reach-guide.png";

  return (
    <main
      className="relative px-5 pt-20 pb-8 sm:px-6 md:px-10 lg:px-10 lg:pt-16 lg:pb-4"
      style={{ background: "linear-gradient(180deg, #FCFBF9 0%, #F6F3EE 100%)" }}
    >
      {/* ★重要: 右上のログイン状態UI（ログアウト）は、TOP本体の
          通常フローから完全に分離する。position:absoluteで重ねて配置するため、
          これが表示されるかどうかで main・Hero の margin/padding/開始位置が
          一切変化しない。mainの pt-20 / lg:pt-16 は「ログアウト時に空の領域を
          確保する」ためのものではなく、現在のログイン中の見た目（バー＋余白の
          高さ分）を基準にした固定値であり、user の有無に関わらず常に同じ値。
          ★「美容師マイページへ」「サロンマイページへ」は、下部の美容師/サロン
          カード内に同じ導線が既にあり重複していたため、ここでは削除した
          （ログイン判定・role判定・hasStylist/hasSalonの算出方法・カード側の
          実装・ログアウト機能自体は変更していない）。 */}
      {user && (
        <div className="absolute right-5 top-4 z-10 flex flex-wrap items-center justify-end gap-2 text-[11px] sm:right-6 sm:top-5 md:right-10 lg:right-10 lg:top-5 lg:text-[12.5px]">
          <form action={signOutAction}>
            <SubmitButton pendingText="...">
              <span className="rounded-full px-3 py-1.5 text-[11px] font-semibold text-sub underline lg:text-[12.5px]">
                ログアウト
              </span>
            </SubmitButton>
          </form>
        </div>
      )}

      {/* Hero行。左側コンテンツ（ロゴ・見出し・CTA・3メリット）の幅・
          レイアウトは既存のまま一切変更しない（lg:max-w-[860px]、非flex、
          通常フロー内での開始位置も不変）。Hero行自体の高さも変更しない
          （min-heightは追加しない＝下部カードの開始位置は従来のまま）。
          ★キャラクターを完成イメージに近い大きさで見せるため、Hero行の
          「CSSボックスとしての高さ」を広げるのではなく、absolute配置の
          キャラクターがこの行の表示領域から視覚的にはみ出す方式にする。
          overflow-visible を明示し（デフォルトでもvisibleだが、意図を
          明確にするため）、上（ログインUI方向）にも下（カード方向）にも
          はみ出せるようにする。キャラクターの重なり順は
          components/home/hero-character.tsx 側のz-indexで、
          「右上ログインUI＞キャラクター」「下部カード＞キャラクター」
          となるよう調整している（カード行に relative z-10 を付与）。
          コンテンツ幅は1320px前後で中央配置する（margin-leftに寄せない）。 */}
      <div className="mx-auto w-full max-w-[1320px]">
        <div className="relative overflow-visible">
          <div className="lg:max-w-[860px]">
            <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
              {/* ロゴ: 画像ではなくCSS/HTMLで組んだ横長ロゴ（BRマーク＋ワードマーク）。
                  黄色みの強い金色画像から、ブロンズ〜カッパー系の単色グラデーションへ
                  変更した。タグラインもこのブロック内に統合し、縦方向を大幅に圧縮する
                  （画像ロゴ比で高さを半分以下にした。項目1の余白圧縮に直結）。 */}
              <div className="flex items-center gap-3 lg:gap-4">
                <div
                  className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl lg:h-[76px] lg:w-[76px]"
                  style={{ background: "linear-gradient(135deg, #A66A3F 0%, #7A4B2A 100%)" }}
                >
                  <span className="font-serif text-[20px] font-bold text-white lg:text-[27px]">BR</span>
                </div>
                <div className="text-left">
                  <p
                    className="font-serif font-bold leading-none tracking-wide text-[21px] lg:text-[30px]"
                    style={{ color: "#8B5E34" }}
                  >
                    BEAUTY REACH
                  </p>
                  <p className="eyebrow mt-1.5" style={{ color: "#9A6A3A" }}>
                    美容師の市場価値診断＆マッチング
                  </p>
                </div>
              </div>

              {/* Heroキャラクター(スマホ用)。今回はPCのみを対象とするため、
                  スマホ表示は次工程で調整する（意図的に非表示のまま）。 */}

              <h1 className="mt-5 font-serif font-bold leading-[1.3] text-ink text-[28px] sm:text-[32px] lg:mt-4 lg:text-[38px] lg:leading-[1.15]">
                あなたの才能が、
                <br />
                未来を変える。
              </h1>

              {/* 説明文はPC専用・スマホ専用に分離している。
                  ・PC(lg:): 現在の文言・改行を1文字も変更していない。
                  ・スマホ: 各行を <br/> ではなく明示的な block の <span>
                    にすることで、ブラウザの自動折り返しに依存せず、
                    393px幅でも必ずこの3行構成が維持されるようにした
                    （各spanの中身自体は353px程度の利用可能幅に対して
                    十分短いため、span内で再度折り返されることもない）。
                  ★正直な注記: スマホ3行目「相性の良いサロンが分かります。」
                  は、PCで表示している文言「あなたに合うサロンが分かります。」
                  とは異なる言い回しです。ご指示を文字どおり実装しています。 */}
              <p className="hidden text-[14px] leading-[1.8] text-charcoal lg:mt-1.5 lg:block lg:text-[13.5px] lg:leading-[1.4]">
                30の質問に答えるだけで、
                <br />
                あなたの美容師タイプ・市場価値・あなたに合うサロンが分かります。
              </p>
              <p className="mt-3 block text-[14px] leading-[1.8] text-charcoal lg:hidden">
                <span className="block">30の質問に答えるだけで、</span>
                <span className="block">あなたの美容師タイプ・市場価値・</span>
                <span className="block">相性の良いサロンが分かります。</span>
              </p>

              {/* Heroキャラクター。
                  ・PC: components/home/hero-character.tsx 内の absolute 配置
                    （right-65/bottom--125/z-1、Hero行からの視覚的なはみ出し）
                    をそのまま使用。呼び出し位置をここへ移動しても、absolute
                    配置はDOM順序に依存しないため、PCの見た目は一切変わらない。
                  ・スマホ: 新規に通常フロー内表示を追加した。説明文とCTAの
                    間に、案内役として認識できるサイズ（180〜230px程度）で
                    中央配置する。PC用のabsolute値は流用していない。
                  画像が存在しない場合はHeroCharacterが自動的に何も描画しない。 */}
              {HERO_CHARACTER_SRC && <HeroCharacter src={HERO_CHARACTER_SRC} alt="" />}

              {/* ★最重要CTA。横幅を活かし、高さは抑える。 */}
              <Link
                href="/stylist/diagnosis"
                className="mt-6 flex w-full items-center justify-center gap-2 rounded-full px-6 text-center font-bold text-surface shadow-md py-4 text-[16px] lg:mt-2.5 lg:w-[78%] lg:h-[54px] lg:py-0 lg:text-[15px]"
                style={{ backgroundColor: "#8B5E34" }}
              >
                <Sparkles size={17} />
                30問であなたのタイプを診断する
                <ArrowRight size={17} />
              </Link>

              <div className="mt-5 grid w-full grid-cols-3 gap-2 lg:mt-2.5 lg:w-[78%] lg:gap-3">
                <div className="flex flex-col items-center gap-1.5 text-center lg:gap-1">
                  <ListChecks size={19} style={{ color: "#8A6D3B" }} />
                  <p className="text-[10.5px] leading-tight text-sub lg:text-[11px] lg:leading-[1.35]">
                    30問で簡単診断
                    <br />
                    約5分で完了
                  </p>
                </div>
                <div className="flex flex-col items-center gap-1.5 text-center lg:gap-1">
                  <BarChart3 size={19} style={{ color: "#8A6D3B" }} />
                  <p className="text-[10.5px] leading-tight text-sub lg:text-[11px] lg:leading-[1.35]">
                    市場価値がわかる
                    <br />
                    客観的に評価
                  </p>
                </div>
                <div className="flex flex-col items-center gap-1.5 text-center lg:gap-1">
                  <Heart size={19} style={{ color: "#8A6D3B" }} />
                  <p className="text-[10.5px] leading-tight text-sub lg:text-[11px] lg:leading-[1.35]">
                    相性の良いサロンと
                    <br />
                    マッチング
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* カード行: Heroの下、ページ幅のほぼ100%を使って美容師/サロンを
            横並びに配置する。高さは揃え、文字・ボタンは縮小しすぎない。 */}
        <div className="relative z-10 mt-10 space-y-4 sm:flex sm:items-stretch sm:gap-5 sm:space-y-0 lg:mt-4 lg:gap-6">
          <section
            className="rounded-[24px] p-5 shadow-sm sm:flex sm:flex-1 sm:flex-col lg:w-1/2 lg:p-4"
            style={{ backgroundColor: "#F2EEFA" }}
          >
            <div className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-full lg:h-9 lg:w-9"
                style={{ backgroundColor: "#E1D6F4" }}
              >
                <UserRound size={19} style={{ color: "#6E4AA6" }} />
              </span>
              <div>
                <h2 className="font-serif text-[18px] font-bold text-ink lg:text-[16.5px]">美容師の方</h2>
                <span
                  className="inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                  style={{ backgroundColor: "#E1D6F4", color: "#6E4AA6" }}
                >
                  8タイプ診断
                </span>
              </div>
            </div>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-charcoal lg:mt-2 lg:text-[12.5px] lg:leading-snug">
              あなたのタイプ・市場価値・相性の良いサロンが分かります
            </p>
            <div className="sm:mt-auto">
              {hasStylist ? (
                <Link
                  href="/stylist/mypage"
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full px-6 py-3.5 text-[14.5px] font-semibold text-surface lg:mt-2.5 lg:py-2.5 lg:text-[13.5px]"
                  style={{ backgroundColor: "#6E4AA6" }}
                >
                  美容師マイページへ
                  <ArrowRight size={15} />
                </Link>
              ) : user ? (
                // ログイン済みだが美容師roleを持たない場合、ログイン導線は
                // middlewareのGUEST_ONLY_PATHSにより押しても/へ戻されて
                // しまうため表示しない。非クリックの案内表示にとどめる。
                <p className="mt-3 rounded-full border border-line bg-surface px-6 py-3.5 text-center text-[13px] text-sub lg:mt-2.5 lg:py-2.5">
                  美容師アカウントでログインするとご利用いただけます
                </p>
              ) : (
                <Link
                  href="/stylist/login"
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full px-6 py-3.5 text-[14.5px] font-semibold text-surface lg:mt-2.5 lg:py-2.5 lg:text-[13.5px]"
                  style={{ backgroundColor: "#6E4AA6" }}
                >
                  美容師としてログイン
                  <ArrowRight size={15} />
                </Link>
              )}
              {!hasStylist && !user && (
                <p className="mt-2 text-center text-[12px] text-sub lg:mt-1 lg:text-[11px]">
                  初めての方は30問の診断から始めましょう
                </p>
              )}
            </div>
          </section>

          <section
            className="rounded-[24px] p-5 shadow-sm sm:flex sm:flex-1 sm:flex-col lg:w-1/2 lg:p-4"
            style={{ backgroundColor: "#EAF3EC" }}
          >
            <div className="flex items-center gap-3">
              <span
                className="flex h-10 w-10 items-center justify-center rounded-full lg:h-9 lg:w-9"
                style={{ backgroundColor: "#D3E7D9" }}
              >
                <Store size={19} style={{ color: "#2E8B7F" }} />
              </span>
              <div>
                <h2 className="font-serif text-[18px] font-bold text-ink lg:text-[16.5px]">サロンの方</h2>
                <span
                  className="inline-block rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
                  style={{ backgroundColor: "#D3E7D9", color: "#2E8B7F" }}
                >
                  サロン分析
                </span>
              </div>
            </div>
            <p className="mt-2.5 text-[13.5px] leading-relaxed text-charcoal lg:mt-2 lg:text-[12.5px] lg:leading-snug">
              サロンの魅力・相性の良い美容師・マッチングができます
            </p>
            <div className="sm:mt-auto">
              {hasSalon ? (
                <Link
                  href="/salon/mypage"
                  className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full px-6 py-3.5 text-[14.5px] font-semibold text-surface lg:mt-2.5 lg:py-2.5 lg:text-[13.5px]"
                  style={{ backgroundColor: "#2E8B7F" }}
                >
                  サロンマイページへ
                  <ArrowRight size={15} />
                </Link>
              ) : user ? (
                // ログイン済みだがサロンroleを持たない場合、ログイン・新規登録
                // 導線はmiddlewareのGUEST_ONLY_PATHSにより押しても/へ戻されて
                // しまうため表示しない。非クリックの案内表示にとどめる。
                <p className="mt-3 rounded-full border border-line bg-surface px-6 py-3.5 text-center text-[13px] text-sub lg:mt-2.5 lg:py-2.5">
                  サロンアカウントでログインするとご利用いただけます
                </p>
              ) : (
                <>
                  <Link
                    href="/salon/login"
                    className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full px-6 py-3.5 text-[14.5px] font-semibold text-surface lg:mt-2.5 lg:py-2.5 lg:text-[13.5px]"
                    style={{ backgroundColor: "#2E8B7F" }}
                  >
                    サロンとしてログイン
                    <ArrowRight size={15} />
                  </Link>
                  <p className="mt-2 text-center text-[12px] text-sub lg:mt-1 lg:text-[11px]">
                    初めての方は
                    <Link href="/signup/salon" className="underline">
                      サロン登録
                    </Link>
                    から始めましょう
                  </p>
                </>
              )}
            </div>
          </section>
        </div>

        {/* Beauty Reachでできること */}
        <div className="mt-12 text-center lg:mt-10">
          <div className="flex items-center justify-center gap-4">
            <hr className="h-px w-10 border-0" style={{ backgroundColor: "#8A6D3B" }} />
            <p className="font-serif text-[15px] font-semibold text-ink">Beauty Reachでできること</p>
            <hr className="h-px w-10 border-0" style={{ backgroundColor: "#8A6D3B" }} />
          </div>
        </div>
      </div>
    </main>
  );
}
