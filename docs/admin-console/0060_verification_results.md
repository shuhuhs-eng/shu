# 0060 検証結果（ローカル検証DB・2026-11-14）

- 環境: ローカルの Postgres 16（本番ではない）。本番の schema 全体ではなく、0057 までを適用した検証DB。
- 実行: `0060_verify.sql`（適用済みDBでBEGIN→ROLLBACK）。**結果: 56項目 PASS / 0 FAIL**。
- 併せて、`0060_preapply_check.sql` → 0060適用 → `0060_postapply_check.sql` を通しで実行し、次を確認:
  - 適用前: 0060の関数なし(0)・読む15列がすべて存在・is_platform_admin は SECURITY DEFINER。
  - 適用後: 4関数＋内部関数が存在。4関数は SECURITY DEFINER・STABLE・search_path固定。anon は実行不可、authenticated は4関数のみ実行可、内部関数 `_admin_known_prefectures` は authenticated も不可。
  - 一般ログイン利用者は4関数すべて `admin access required`、未ログイン(anon)は `permission denied for function`。
  - 既存8表の権限(ACL)と行数は適用前後で差分なし。
- 未確認: 本番DBでの実行、PostgREST経由のアプリからの呼び出し、運営者アカウントでの画面表示（本番の admin 登録が済んでいないため）。

## 項目別の結果（0060_verify.sql）
```
  1 | PASS   | A1 anonは実行できない: select public.admin_list_organizations()
  2 | PASS   | A2 一般利用者1は拒否: select public.admin_list_organizations()
  3 | PASS   | A2 一般利用者2は拒否: select public.admin_list_organizations()
  4 | PASS   | A2 一般利用者3は拒否: select public.admin_list_organizations()
  5 | PASS   | A2 一般利用者4は拒否: select public.admin_list_organizations()
  6 | PASS   | A1 anonは実行できない: select public.admin_get_organization('00
  7 | PASS   | A2 一般利用者1は拒否: select public.admin_get_organization('00
  8 | PASS   | A2 一般利用者2は拒否: select public.admin_get_organization('00
  9 | PASS   | A2 一般利用者3は拒否: select public.admin_get_organization('00
 10 | PASS   | A2 一般利用者4は拒否: select public.admin_get_organization('00
 11 | PASS   | A1 anonは実行できない: select public.admin_list_stylists()
 12 | PASS   | A2 一般利用者1は拒否: select public.admin_list_stylists()
 13 | PASS   | A2 一般利用者2は拒否: select public.admin_list_stylists()
 14 | PASS   | A2 一般利用者3は拒否: select public.admin_list_stylists()
 15 | PASS   | A2 一般利用者4は拒否: select public.admin_list_stylists()
 16 | PASS   | A1 anonは実行できない: select public.admin_get_stylist('0000000
 17 | PASS   | A2 一般利用者1は拒否: select public.admin_get_stylist('0000000
 18 | PASS   | A2 一般利用者2は拒否: select public.admin_get_stylist('0000000
 19 | PASS   | A2 一般利用者3は拒否: select public.admin_get_stylist('0000000
 20 | PASS   | A2 一般利用者4は拒否: select public.admin_get_stylist('0000000
 21 | PASS   | A3 sub無し(未ログイン相当)は拒否
 22 | PASS   | B1 会社名で検索
 23 | PASS   | B2 店舗名で検索→該当会社と、その店舗が行に含まれる
 24 | PASS   | B3 登録メール（大文字小文字を区別しない）で検索
 25 | PASS   | B4 店舗担当者名で検索→その店舗の会社
 26 | PASS   | B5 % は特殊文字として働かない（全件にならない）
 27 | PASS   | B6 都道府県(店舗の所在地)で絞り込み
 28 | PASS   | B7 店舗プロフィールの所在地(東京都)が店舗側の値(null)より優先されて当たる
 29 | PASS   | B8 大阪府の絞り込み（アルファは当たらず、ベータは当たる）
 30 | PASS   | B9 所在地が未設定の店舗がある会社を「未設定」で絞り込める
 31 | PASS   | B10 全店舗の所在地が設定済みの会社は「未設定」に出ない
 32 | PASS   | B11 公開状態で絞り込み
 33 | PASS   | B12 公開店が無い会社は公開で当たらない
 34 | PASS   | B13 不正な絞り込み値は拒否
 35 | PASS   | B14 件数は100に丸める
 36 | PASS   | B15 limit=1 でも total は全体件数
 37 | PASS   | C1 会社詳細: 全店舗(3)
 38 | PASS   | C2 会社詳細: 店舗所在地の出どころ(profile/store/未設定)を区別
 39 | PASS   | C3 会社詳細: 登録担当者(会社権限)と店舗担当者(店舗権限)を分けて返す
 40 | PASS   | C4 会社詳細: 他社(ベータ)の担当者は混ざらない
 41 | PASS   | C5 存在しない会社は not found
 42 | PASS   | D1 美容師を名前で検索（公開名・本名）
 43 | PASS   | D2 美容師をメールで検索
 44 | PASS   | D3 居住地で絞り込み（勤務希望は無関係）
 45 | PASS   | D4 勤務希望地で絞り込み（居住地が神奈川の さくら は当たらない）
 46 | PASS   | D5 勤務希望: 東京都は さくら・あおい
 47 | PASS   | D6 居住地「未設定」で絞り込み
 48 | PASS   | D7 居住地・勤務希望が空でも行は出て、値はnull（画面で「未設定」）
 49 | PASS   | D8 公開状態で絞り込み
 50 | PASS   | E1 美容師詳細: 居住地と勤務希望を別項目で返す
 51 | PASS   | E2 美容師詳細: 診断の回答・スコアの本文は返さない（タイプ名と日時のみ）
 52 | PASS   | E3 美容師詳細: 年代・性別などは返さない
 53 | PASS   | E4 運営者でも、サロン用アカウントのIDは美容師として引けない
 54 | PASS   | F1 4関数は読み取りのみ（STABLE）
 55 | PASS   | F2 4関数とも SECURITY DEFINER・search_path固定
 56 | PASS   | F3 内部関数 _admin_known_prefectures は一般利用者が呼べない
```
