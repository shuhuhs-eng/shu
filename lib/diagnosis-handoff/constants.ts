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
 * signUp の応答のユーザーを「今回の処理で作られた」と見なす、作成時刻からの最大経過時間。
 * Supabaseは登録済み（確認待ち）のメールで再登録しても、既存ユーザーを返す（作成時刻は過去のまま）。
 * その場合を「新しく作られた」と誤認しないための確認。サーバー間の時計のずれを見込んで2分。
 */
export const SIGNUP_CREATED_WITHIN_MS = 2 * 60 * 1000;
