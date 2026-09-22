/**
 * 診断ロジックのバージョン。
 * 質問・重み・スコアリング・タイプ写像・市場価値式のいずれかを変更したら必ず上げる。
 * diagnosis_results / pending_diagnoses に保存し、将来の再計算・移行の基準にする。
 */
export const DIAGNOSIS_VERSION = "1.0.0";

/**
 * Golden スナップショットテストのバージョン。
 * scripts/diagnosis-golden.json の中身（比較項目・生成方法・件数など）を
 * 変更したときに上げる。DIAGNOSIS_VERSION とは別軸で管理する:
 *
 *   - DIAGNOSIS_VERSION が変わった   → 判定ロジックの値が変わった。
 *                                      golden は「変更前の期待値」なので、
 *                                      意図的な変更を確認した上で
 *                                      npm run generate:golden で再生成し、
 *                                      golden.meta.diagnosisVersion を
 *                                      新バージョンへ更新する。
 *   - GOLDEN_TEST_VERSION が変わった → テストの比較項目・件数・生成方法など、
 *                                      スナップショットの形式自体が変わった。
 *
 * verify-diagnosis.mts は golden.meta のこの2つの値を読み取り、
 * 現在のコードの値と一致しない場合はテストを実行せず即座に失敗させる
 * （バージョンがずれた golden を気づかず比較してしまう事故を防ぐ）。
 */
export const GOLDEN_TEST_VERSION = "1.0.0";
