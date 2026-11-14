# 0060 本番適用の手順（記録用。適用は人が行う）

対象は `supabase/migrations/0060_admin_directory.sql` のみ。0058・0059・0061〜0064は含まない。
SQLエディタ（またはmigrationの適用）は、Supabaseの本番プロジェクトで人が実行する。Claudeは本番に接続・適用しない。

## 手順
1. **適用前チェック** `0060_preapply_check.sql` を実行。
   - 全行 PASS（最後の行は INFO）で、エラーなく終わること。
   - **FAIL が1つでもあれば、最後に「適用前チェックに FAIL があります」で止まる。その場合は本体を適用せず、FAIL の行（name / info）を共有して内容を確認する。**
   - INFO のハッシュ（5行目の値）を控える。
2. **本体** `supabase/migrations/0060_admin_directory.sql` を適用（begin〜commit 1回）。エラーが出たら自動でロールバックされる。
3. **適用後チェック** `0060_postapply_check.sql` を実行。
   - FAIL 0 であること。SKIP は「運営者が0件」の場合のみ出る（下記）。
   - INFO のハッシュが、手順1のハッシュと一致すること（既存の表の権限・行数に変化なし。適用の間に行数が動いた場合は権限部分だけ確認）。
4. 運営者アカウントでログインし、アプリの /admin/salons・/admin/stylists で表示を確認（アプリ側は、この確認まで push を保留）。

## 問題があった場合
`0060_rollback.sql` を実行（関数の削除のみ。表・データ・権限は変えていないので影響なし）。実行後、適用前チェックを再実行して手順1のハッシュと一致すれば、元の状態。

## platform_admins が0件の場合（適用前チェックの項目4が FAIL）
**任意のアカウントを自動で登録しない。** 次の順で、対象ユーザーを人が確認する。
1. 読み取りだけの確認（何も変更しない）:
   ```sql
   select id, email, created_at, email_confirmed_at, last_sign_in_at
   from auth.users
   where lower(email) = 'admin@beautyreach.jp';
   ```
   - 0行: アカウントがまだ無い。Supabase の Authentication で作成・メール確認が済んでいるかを、運営の方が確認する。
   - 1行: id・作成日時・メール確認済みかが、意図したアカウントか確認する。
   - 同じメールが複数に見える場合は登録しない（大文字小文字違い等。内容を共有して確認）。
2. 対象の id を確認したうえで、**確認した方が**登録を実行（これは0060とは別の本番操作で、実行の承認は別途）:
   ```sql
   insert into public.platform_admins (user_id) values ('<確認した id>');
   ```
3. 適用前チェックを再実行し、項目4が PASS になることを確認してから、手順2へ。
（運営者の判定はメール文字列では行わない。platform_admins の行だけで判定する。）

## 確認できていないこと
本番での実行結果、本番の `auth.users.email_confirmed_at` 列の存在（適用前チェックの列確認が見る）、運営者アカウントでの実画面表示。
