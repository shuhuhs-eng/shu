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
