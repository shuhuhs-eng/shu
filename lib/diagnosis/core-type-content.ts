import type { CoreTypeCode } from "./core-types";

/** 強みカード1件（アイコン付き短いラベル）。 */
export type StrengthCard = { icon: string; label: string };

/** 「向いている環境」カード1件。starsは1〜5（断定的な推薦ではなく、その人の強みとの相性の強さを表す）。 */
export type EnvironmentCard = { icon: string; label: string; stars: number };

export type CoreTypeContent = {
  name: string;
  /**
   * キャラクター固有名（例: "ジマ"）。将来のキャラクター表示・
   * マッチング画面で共通利用するためのデータ。表示への反映は今回行わない。
   */
  characterName: string;
  /**
   * タイプの代表カラー（HEX）。マイページの8タイプヘッダーでアクセント
   * カラーとして使用する。
   */
  primaryColor: string;
  /** タイプを代表する絵文字/文字アイコン。マイページの8タイプヘッダーで
   * タイプ名の前に表示する。 */
  icon: string;
  catchphrase: string;
  /**
   * マイページの8タイプヘッダーで表示する、そのタイプ専用のキャッチコピー
   * （2行の対比構造）。「あなたの才能タイプは」ラベル＋アイコン＋タイプ名の
   * 直後に表示する。改行位置は "\n" で保持する。
   */
  heroHeadline: string;
  /**
   * マイページの8タイプヘッダーで表示する、「まだ本人が気づいていない
   * 才能」を示す短い一文。heroHeadlineの下に表示する。
   */
  hiddenTalent: string;
  strengthCards: StrengthCard[];
  workStyle: string;
  /** 「あなたの強みが活きやすい環境傾向」。断定的な推薦表現は使わない。 */
  environmentCards: EnvironmentCard[];
  /**
   * キャラクター画像のasset path。UIコードはこの値経由でのみ画像を参照し、
   * パスを直書きしない（将来、Pixar風3D・親しみやすい・上質なキャラクターへ
   * 差し替える際にこのデータだけを更新すれば済むようにするため）。
   * 現時点ではプレースホルダー画像（public/characters/配下のSVG）。
   */
  characterImagePath: string;
};

/**
 * 8タイプの静的コンテンツ。AI生成ではなく、編集済みの固定データとして管理する
 * （既存12タイプの fullType() と同じ方針）。
 *
 * TODO（次フェーズ以降・requirements-v1.0.md 12.1節）: 現時点ではAI解説の
 * 生成ロジックを変更していない。将来、12タイプ（内部詳細）＋8タイプ（表側称号）
 * ＋6才能スコアをAIプロンプトへ統合し、両タイプの表現が矛盾しない解説文を
 * 生成できるようにする。
 */
export const CORE_TYPE_CONTENT: Record<CoreTypeCode, CoreTypeContent> = {
  shimei_jishaku: {
    name: "指名磁石",
    characterName: "ジマ",
    primaryColor: "#C0392B",
    icon: "🧲",
    catchphrase: "会うたびに、また会いたくなる人。",
    heroHeadline: "「またあなたにお願いしたい。」\nそう思わせる力は、技術だけじゃない。",
    hiddenTalent: "あなたには、人を惹きつけ、“あなた自身”を選んでもらえる才能があります。",
    strengthCards: [
      { icon: "💬", label: "接客力" },
      { icon: "📱", label: "発信力" },
      { icon: "🤝", label: "信頼構築" },
    ],
    workStyle: "お客様との関係構築を軸にした指名制サロンや、SNS発信を評価する環境で力を発揮します。",
    environmentCards: [
      { icon: "💇", label: "指名制サロン", stars: 5 },
      { icon: "📱", label: "SNS活用サロン", stars: 5 },
      { icon: "🏡", label: "個人ブランドを大事にする文化", stars: 4 },
    ],
    characterImagePath: "/characters/shimei_jishaku.png",
  },
  aisare_ace: {
    name: "愛されエース",
    characterName: "サクラ",
    primaryColor: "#D66FA0",
    icon: "🌸",
    catchphrase: "技術も人柄も、どちらも本物。",
    heroHeadline: "気づけば相談される。\n気づけば、あなたを頼っている。",
    hiddenTalent: "あなたには、人との距離を自然に縮め、信頼をファンに変える才能があります。",
    strengthCards: [
      { icon: "✂️", label: "技術力" },
      { icon: "😊", label: "接客力" },
      { icon: "🌱", label: "指導力" },
    ],
    workStyle: "幅広い年代・客層に対応する総合力が求められる環境や、教育も担う立場で力を発揮します。",
    environmentCards: [
      { icon: "👥", label: "幅広い客層のサロン", stars: 5 },
      { icon: "🎓", label: "育成に関われる環境", stars: 4 },
      { icon: "🏢", label: "総合力を評価する文化", stars: 4 },
    ],
    characterImagePath: "/characters/aisare_ace.png",
  },
  niaiwase_master: {
    name: "似合わせマスター",
    characterName: "ミラー",
    primaryColor: "#6E4AA6",
    icon: "✨",
    catchphrase: "その人だけの「似合う」を見つけ出す。",
    heroHeadline: "似合うには、理由がある。\nあなたは、その答えを見つけられる。",
    hiddenTalent: "あなたには、まだ言葉になっていない魅力を見つけ、カタチにする才能があります。",
    strengthCards: [
      { icon: "✂️", label: "技術力" },
      { icon: "🎨", label: "センス" },
      { icon: "💡", label: "提案力" },
    ],
    workStyle: "技術力と提案力を評価する環境や、カット・カラーの技術追求ができるサロンで力を発揮します。",
    environmentCards: [
      { icon: "🎓", label: "技術教育が充実したサロン", stars: 5 },
      { icon: "💇", label: "こだわりの技術を評価する文化", stars: 5 },
      { icon: "✂️", label: "カット・カラー重視のサロン", stars: 4 },
    ],
    characterImagePath: "/characters/niaiwase_master.png",
  },
  trend_maker: {
    name: "トレンドメーカー",
    characterName: "フレア",
    primaryColor: "#E0863A",
    icon: "🔥",
    catchphrase: "次のトレンドを、自分の手でつくる。",
    heroHeadline: "流行を追う側じゃない。\n次の“かわいい”を生み出す側。",
    hiddenTalent: "あなたには、発信と感性で人を動かし、新しい流れをつくる才能があります。",
    strengthCards: [
      { icon: "🎨", label: "センス" },
      { icon: "📱", label: "発信力" },
      { icon: "🚀", label: "挑戦意欲" },
    ],
    workStyle: "トレンド発信やSNS活用に積極的なサロン、クリエイティブな表現を歓迎する環境で力を発揮します。",
    environmentCards: [
      { icon: "📱", label: "SNS発信に積極的なサロン", stars: 5 },
      { icon: "✨", label: "トレンド重視のサロン", stars: 5 },
      { icon: "🎨", label: "表現の自由度が高い環境", stars: 4 },
    ],
    characterImagePath: "/characters/trend_maker.png",
  },
  iyashi_charisma: {
    name: "癒しのカリスマ",
    characterName: "リーフ",
    primaryColor: "#4C9A6C",
    icon: "🌿",
    catchphrase: "そこにいるだけで、安心できる。",
    heroHeadline: "「また会いたい」は、\n最高の美容技術のひとつ。",
    hiddenTalent: "あなたには、安心感と居心地の良さで、人を惹きつけ続ける才能があります。",
    strengthCards: [
      { icon: "😌", label: "安心感" },
      { icon: "🌱", label: "面倒見の良さ" },
      { icon: "🤲", label: "対応力" },
    ],
    workStyle: "ゆったりとした接客スタイルや、丁寧なカウンセリングを大切にするサロンで力を発揮します。",
    environmentCards: [
      { icon: "🕊️", label: "落ち着いた客層のサロン", stars: 5 },
      { icon: "💬", label: "接客の質を重視する文化", stars: 5 },
      { icon: "🏡", label: "ゆったりとした接客スタイル", stars: 4 },
    ],
    characterImagePath: "/characters/iyashi_charisma.png",
  },
  repeat_king: {
    name: "リピートキング",
    characterName: "レオ",
    primaryColor: "#B8923F",
    icon: "👑",
    catchphrase: "一度来たら、また会いに来たくなる。",
    heroHeadline: "一度のお客様を、\nずっと通いたいお客様へ。",
    hiddenTalent: "あなたには、信頼を積み重ね、長く選ばれ続ける才能があります。",
    strengthCards: [
      { icon: "✂️", label: "技術力" },
      { icon: "🤝", label: "信頼構築" },
      { icon: "🚀", label: "挑戦意欲" },
    ],
    workStyle: "顧客満足度・リピート率を重視するサロンや、技術と接客の両方を評価する環境で力を発揮します。",
    environmentCards: [
      { icon: "🔁", label: "リピート率重視のサロン", stars: 5 },
      { icon: "⚖️", label: "技術と接客を両立する文化", stars: 5 },
      { icon: "💎", label: "顧客満足度を大切にする経営", stars: 4 },
    ],
    characterImagePath: "/characters/repeat_king.png",
  },
  mirai_no_ace: {
    name: "未来のエース",
    characterName: "ルーチェ",
    primaryColor: "#3B6EA8",
    icon: "💎",
    catchphrase: "伸びしろは、誰よりも大きい。",
    heroHeadline: "今の実力だけでは、\nあなたの価値は測れない。",
    hiddenTalent: "あなたには、経験を吸収しながら、大きく伸びていく才能があります。",
    strengthCards: [
      { icon: "🚀", label: "挑戦意欲" },
      { icon: "📈", label: "成長スピード" },
      { icon: "🌟", label: "積極性" },
    ],
    workStyle: "若手の成長を支援する教育体制が整ったサロンや、挑戦の機会が多い環境で力を発揮します。",
    environmentCards: [
      { icon: "🎓", label: "若手育成に力を入れるサロン", stars: 5 },
      { icon: "🌱", label: "挑戦を後押しする文化", stars: 5 },
      { icon: "📚", label: "教育体制が整った環境", stars: 4 },
    ],
    characterImagePath: "/characters/mirai_no_ace.png",
  },
  brand_builder: {
    name: "ブランドビルダー",
    characterName: "アーク",
    primaryColor: "#7A4B2A",
    icon: "🏛️",
    catchphrase: "自分だけでなく、チームごと輝かせる。",
    heroHeadline: "誰かの真似ではなく、\n“あなたにしかない価値”をつくる。",
    hiddenTalent: "あなたには、自分の世界観を育て、唯一無二のブランドに変える才能があります。",
    strengthCards: [
      { icon: "📱", label: "発信力" },
      { icon: "🌱", label: "育成力" },
      { icon: "🚀", label: "挑戦意欲" },
    ],
    workStyle: "サロン全体のブランディングや、チームマネジメントに関わる立場で力を発揮します。",
    environmentCards: [
      { icon: "🏆", label: "ブランディングに力を入れるサロン", stars: 5 },
      { icon: "👑", label: "幹部候補を求める環境", stars: 5 },
      { icon: "👥", label: "チームマネジメントに関われる文化", stars: 4 },
    ],
    characterImagePath: "/characters/brand_builder.png",
  },
};
