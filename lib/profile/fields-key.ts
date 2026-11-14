/**
 * 保存済みの値が変わったときにフォーム欄を作り直すためのキー（画面の欄と保存済みの値を常に一致させる）。
 * React 19 のフォームは、保存の実行後に入力欄を「直前の初期値」へ戻す。サーバーの再取得で新しい初期値が届いても、
 * 欄を作り直さない限り戻った古い値が表示され続けるため、初期値が変わったら欄を作り直す。
 * 署名付きURLは表示のたびに変わるのでキーに含めない。
 */
export function profileFieldsKey(values: Record<string, unknown>): string {
  const { avatarSignedUrl: _ignored, ...rest } = values;
  void _ignored;
  return JSON.stringify(rest);
}
