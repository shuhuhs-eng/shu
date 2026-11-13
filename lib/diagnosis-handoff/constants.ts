/** 未ログイン診断のclaim_tokenを保持するhttpOnly Cookie名。 */
export const CLAIM_TOKEN_COOKIE = "br_claim_token";

/** Cookieの最大保持期間（秒）。pending_diagnoses.expires_at と概ね合わせる（30日）。 */
export const CLAIM_TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * 診断クイズ画面(app/diagnosis/page.tsx)が計算結果(ComputedDiagnosis)を
 * 結果画面(app/diagnosis/result/page.tsx)へ受け渡すためのsessionStorageキー。
 * ブラウザのタブ内でのみ有効な一時的な受け渡しであり、DBには保存されない
 * （真値はpending_diagnosesに保存済みで、claim後にサーバー側で再計算される）。
 */
export const DIAGNOSIS_RESULT_STORAGE_KEY = "br_diagnosis_preview";

/**
 * ログイン済みユーザーの診断が「サーバーへ保存成功した」ことを結果画面へ伝えるsessionStorageキー
 * （保存成功後にのみ診断クイズが書き込む。値は保存したdiagnosis_resultsのid）。
 * 結果画面はこれが無い限り「保存済み」とは表示しない。
 */
export const DIAGNOSIS_SAVED_STORAGE_KEY = "br_diagnosis_saved_id";

/**
 * 「この新規登録は、このブラウザのゲスト診断につながる」ことをサーバーが署名して残すCookie名（httpOnly）。
 * 値は「発行時刻.HMAC」。HMACは、サーバーだけが持つ秘密鍵で（ユーザーID・保留トークンのハッシュ・発行時刻）に
 * 署名したもの。利用者本人が書き換えられる user_metadata や、URL・localStorage の印は使わない。
 * 発行するのは signUp の応答が「今まさに作られた新しいユーザー」を示したときだけ（lib/auth/actions.ts）。
 */
export const CLAIM_BINDING_COOKIE = "br_claim_bind";

/** 署名の有効時間。確認メールを後で開く場合も含めるための上限（Supabaseの確認リンクの最長有効期限と同じ24時間）。 */
export const CLAIM_BINDING_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * signUp の応答のユーザーを「今回の要求で作られた」と見なす条件: 作成時刻が「この要求の開始時刻」以降であること
 * （サーバー間の時計のずれ分だけ手前を許容）。確認待ちの既存ユーザーで再登録すると、Supabaseは既存ユーザーを返し、
 * 作成時刻は要求より前になる。固定の「作成2分以内」では、直前に作られた未確認アカウントへの再登録を
 * 区別できないため、要求の開始時刻を基準にする。
 */
export const SIGNUP_CLOCK_SKEW_MS = 5 * 1000;

/** 新規登録の印を発行したことを、サーバーだけが書ける app_metadata に残すキー（同じアカウントへ2回発行しない）。 */
export const CLAIM_BINDING_ISSUED_APP_METADATA_KEY = "diagnosis_claim_binding_issued_at";

/**
 * 印を有効にするゲスト診断（保留トークンのハッシュ）を、サーバーだけが書ける app_metadata に残すキー。
 * 引き継ぎ時に「署名」と「この記録」の両方が今のゲスト診断と一致して初めて有効になる。
 * 同時要求で複数の印が出ても、記録は最後の1つだけなので、有効になる印は1つだけ（最後に書かれたもの）。
 */
export const CLAIM_BINDING_FOR_APP_METADATA_KEY = "diagnosis_claim_binding_for";

/**
 * 「新規作成」の自己整合の許容。Supabase が1回の作成で付ける時刻同士
 * （作成時刻と、確認メール送信時刻／自動確認の確認時刻）は、ほぼ同時になる。
 * 確認待ちのアカウントへの再登録では、確認メール送信時刻だけが今に更新され、作成時刻は古いまま残るため、差が開く。
 * アプリとDBの時計のずれを含まない（どちらもSupabase側の時計）。
 */
export const SIGNUP_SELF_CONSISTENCY_MS = 500;

/**
 * 新規登録の確認後、ゲスト診断を引き継げなかったことを、マイページで一度案内するための目印（httpOnly Cookie）。
 * 表示のためだけに使い、引き継ぎの判定には一切使わない。診断結果がまだ無い間だけ表示される。
 */
export const GUEST_NOT_CARRIED_NOTICE_COOKIE = "br_guest_notice";
