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
 * 新規アカウント作成時に、ゲスト診断の保留トークンのハッシュを Supabase Auth の user_metadata へ入れるキー。
 * サーバー側の signUp 処理（lib/auth/actions.ts）だけが、その時点の Cookie から計算して入れる。
 * 「この新規アカウントは、このゲスト診断につながる登録として作られた」ことの確認に使う
 * （既存アカウントへのログインや、登録済みメールでの再登録では入らない）。
 */
export const CLAIM_BINDING_METADATA_KEY = "diagnosis_claim_hash";

/** 新規アカウントとして扱う、メール確認（または登録）からの最大経過時間。確認リンクの有効期限より短くする。 */
export const NEW_ACCOUNT_CONFIRMED_WITHIN_MS = 10 * 60 * 1000;

/** 新規アカウントとして扱う、アカウント作成からの最大経過時間（確認メールを後で開く場合を含む）。 */
export const NEW_ACCOUNT_CREATED_WITHIN_MS = 48 * 60 * 60 * 1000;
