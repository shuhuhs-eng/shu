import type { TraitKey } from "./traits";
import { TC } from "./traits";

export type TypeId =
  | "cm" | "hj" | "tc" | "bp" | "sb" | "ed"
  | "sc" | "tt" | "cd" | "fb" | "mt" | "in";

export type TypeDef = { name: string; romaji: string; keys: [TraitKey, TraitKey]; line: string };

// 12タイプ（上位2才能で判定 — ロジック不変）
export const TYPES: Record<TypeId, TypeDef> = {
  cm: { name: "クリエイティブマイスター", romaji: "Creative Meister", keys: ["S", "T"], line: "作品性の高い技術者。感性を技術で完璧に着地させる。" },
  hj: { name: "ホスピタリティ職人", romaji: "Hospitality Artisan", keys: ["T", "H"], line: "確かな技術と信頼で、指名を積み上げる職人。" },
  tc: { name: "トレンドクリエイター", romaji: "Trend Creator", keys: ["S", "B"], line: "世界観を発信し、時代の空気をつくるデザイナー。" },
  bp: { name: "ブランドパイオニア", romaji: "Brand Pioneer", keys: ["B", "A"], line: "自分という看板で、市場を切り拓く開拓者。" },
  sb: { name: "サロンビルダー", romaji: "Salon Builder", keys: ["A", "M"], line: "人と組織を育て、チームで大きくするリーダー。" },
  ed: { name: "エデュケーター", romaji: "Educator", keys: ["M", "H"], line: "人を育て、繋ぎ、現場の温度をつくる。" },
  sc: { name: "スタイリスト・カウンセラー", romaji: "Stylist Counselor", keys: ["H", "S"], line: "似合わせと対話で、その人の物語をデザインする。" },
  tt: { name: "テクニカルチャレンジャー", romaji: "Technical Challenger", keys: ["T", "A"], line: "新しい技術に挑み続ける、探究の人。" },
  cd: { name: "クリエイティブディレクター", romaji: "Creative Director", keys: ["S", "M"], line: "美意識でチームを導く、表現のまとめ役。" },
  fb: { name: "ファンビルダー", romaji: "Fan Builder", keys: ["B", "H"], line: "発信と人柄で、熱量あるファンを生むコミュニケーター。" },
  mt: { name: "マスタートレーナー", romaji: "Master Trainer", keys: ["T", "M"], line: "技を体系化し、次の世代へ継承する匠。" },
  in: { name: "イノベーター", romaji: "Innovator", keys: ["A", "S"], line: "既成概念を壊し、新しい価値を生む革新者。" },
};

// 15ペア → 12タイプの完全写像（両順を定義）
export const PAIR: Record<string, TypeId> = {
  "S,T": "cm", "T,S": "cm", "T,H": "hj", "H,T": "hj", "T,B": "tc", "B,T": "tc",
  "T,A": "tt", "A,T": "tt", "T,M": "mt", "M,T": "mt", "S,H": "sc", "H,S": "sc",
  "S,B": "tc", "B,S": "tc", "S,A": "in", "A,S": "in", "S,M": "cd", "M,S": "cd",
  "H,B": "fb", "B,H": "fb", "H,A": "fb", "A,H": "fb", "H,M": "ed", "M,H": "ed",
  "B,A": "bp", "A,B": "bp", "B,M": "sb", "M,B": "sb", "A,M": "sb", "M,A": "sb",
};

export type CharDef = {
  characterName: string; characterTitle: string; visualConcept: string;
  hairStyle: string; fashion: string; pose: string; symbolItem: string;
};

// 12タイプ キャラクター（画像は /public/characters/<slug>.webp。無ければプレースホルダー）
export const CHAR: Record<TypeId, CharDef> = {
  cm: { characterName: "L'Atelier", characterTitle: "作品を仕上げる人", visualConcept: "静謐なアトリエで一筋を整える、職人肌のアーティスト", hairStyle: "端正に整えたハンサムショート", fashion: "黒エプロン × 上質な白シャツ", pose: "鏡越しに仕上がりを見極める", symbolItem: "セニングシザー" },
  hj: { characterName: "Le Maître", characterTitle: "信頼を積む人", visualConcept: "指名客に囲まれる、安心感のある実力派", hairStyle: "清潔感のあるナチュラルミディ", fashion: "白シャツ × チャコールのベスト", pose: "肩に手を添え鏡で提案する", symbolItem: "コーム" },
  tc: { characterName: "The Editor", characterTitle: "空気をつくる人", visualConcept: "モードとSNSを行き来する、感度の高い発信者", hairStyle: "動きのあるアッシュ系レイヤー", fashion: "旬のセットアップ、抜け感の小物", pose: "作品を撮影する", symbolItem: "スマートフォン" },
  bp: { characterName: "The Founder", characterTitle: "看板を立てる人", visualConcept: "自分の名前で市場を切り拓く、独立志向", hairStyle: "作り込んだショート／潔い刈り上げ", fashion: "テーラードジャケット × デニム", pose: "腕を組み前を見据える", symbolItem: "自身のロゴ" },
  sb: { characterName: "The Captain", characterTitle: "組織を育てる人", visualConcept: "チームを率い、店を大きくするリーダー", hairStyle: "きちんと感のあるセット", fashion: "上質なニット × スラックス", pose: "スタッフの中心に立つ", symbolItem: "サロンの鍵" },
  ed: { characterName: "The Mentor", characterTitle: "人を伸ばす人", visualConcept: "後輩に寄り添い、現場の温度をつくる教育者", hairStyle: "やわらかなパーマミディ", fashion: "ナチュラルなリネンシャツ", pose: "後輩の手元を見守る", symbolItem: "練習用ウィッグ" },
  sc: { characterName: "The Confidant", characterTitle: "似合わせを描く人", visualConcept: "対話から、その人の物語をデザインする", hairStyle: "上品なワンレングスボブ", fashion: "落ち着いたトーンのブラウス", pose: "向き合い、微笑む", symbolItem: "ヘアカタログ" },
  tt: { characterName: "The Explorer", characterTitle: "技を攻める人", visualConcept: "新しい技術に挑み続ける、探究者", hairStyle: "実験的なデザインカラー", fashion: "機能的なオールブラック", pose: "難施術に集中する", symbolItem: "最新の薬剤" },
  cd: { characterName: "The Director", characterTitle: "美意識で導く人", visualConcept: "感性でチームの表現をまとめる、指揮者", hairStyle: "計算されたグレイッシュロング", fashion: "モードな黒のロングコート", pose: "撮影をディレクションする", symbolItem: "ムードボード" },
  fb: { characterName: "The Host", characterTitle: "ファンを生む人", visualConcept: "発信と人柄で、熱量あるファンをつくる", hairStyle: "親しみやすい明るめミディ", fashion: "こなれたカジュアル", pose: "カメラに語りかける", symbolItem: "リングライト" },
  mt: { characterName: "The Master", characterTitle: "技を継ぐ人", visualConcept: "技術を体系化し、次世代へ継承する匠", hairStyle: "端正に整えたショート", fashion: "きちんとしたシャツ × 黒エプロン", pose: "ウィッグで技術指導する", symbolItem: "教材ウィッグ" },
  in: { characterName: "The Visionary", characterTitle: "常識を壊す人", visualConcept: "既成概念を壊し、新しい価値を生む革新者", hairStyle: "他にない攻めたデザイン", fashion: "アヴァンギャルドな装い", pose: "大胆なスタイルを披露する", symbolItem: "アート作品" },
};

export function slugify(romaji: string): string {
  return romaji.toLowerCase().replace(/\s+/g, "-");
}

export type FullType = TypeDef & CharDef & {
  id: TypeId; characterId: TypeId; slug: string;
  imagePath: string; primaryColor: string; secondaryColor: string;
};

export function fullType(id: TypeId): FullType {
  const t = TYPES[id];
  const c = CHAR[id];
  const slug = slugify(t.romaji); // creative-meister / hospitality-artisan / ...
  return {
    id, ...t, ...c,
    characterId: id,
    slug,
    imagePath: `/characters/${slug}.webp`,
    primaryColor: TC[t.keys[0]],
    secondaryColor: TC[t.keys[1]],
  };
}
