# 0060 検証結果 v2（ローカル検証DB・2026-11-14）

**これはローカル検証であり、本番では未確認です。** 本番DBへの適用・実行は行っていません。

## 環境と前提
- ローカルの Postgres 16。0057 までを適用した検証DB（本番の全スキーマではない）。
- 検証DBの `auth.users`（Supabaseの代替定義）には `email_confirmed_at` 列が無かったため、検証DBにだけ列を足して実行した。実際のSupabaseの `auth.users` にこの列があることは、**適用前チェック（列の存在確認の1つ）で本番に対して確認する**（ローカルでは未確認の前提）。

## 通しの確認（適用前 → 適用 → 適用後 → 巻き戻し）
1. 運営者0件の状態で適用前チェック → `4 platform_admins が1件以上` が FAIL、最後に「適用しないでください」で停止（FAILを検出できることの確認）。
2. 運営者を1件用意 → **適用前チェック: PASS 35 / FAIL 0**（スナップショットのハッシュ `4721c28c11a92efc7d1039b281b19457`）。
3. 0060（v2）を適用 → 成功。
4. **適用後チェック: PASS 36 / FAIL 0 / SKIP 0**（ハッシュは適用前と同一 = 既存の表の権限・行数に変化なし）。運営者のIDを借りた読み取り（会社一覧・美容師一覧・会社未作成の登録者・会社詳細・美容師詳細）も成功。
5. **巻き戻し**（0060_rollback.draft.sql）→ 0060の関数は0件に。適用前チェックを再実行して PASS 35・ハッシュ `4721c28c…` と一致（元の状態に戻った）。
6. 再適用 → 成功。`0060_verify.sql` は **86項目 PASS / 0 FAIL**。

## 適用後チェックが「想定した拒否だけをPASS」にしていることの確認（わざと壊して FAIL になるか）
| 壊し方 | 結果 |
|---|---|
| anon に実行権限を付与 | FAIL（付与先に anon／anon が権限エラーにならない） |
| 内部関数に service_role の実行権限を付与 | FAIL（内部関数の付与先が不一致／service_role が実行可） |
| 一般利用者でも拒否されない関数に差し替え | FAIL（拒否されなかった） |
| 関数の中で列名エラー（42703）を起こす | FAIL（一般利用者の拒否が `admin access required` ではなく42703／運営者での動作もFAIL） |

いずれも最後にエラーで停止する。権限エラー（42501）と関数内部の実装エラーは別物として判定する。

## v2 の修正と対応する検証
| 指摘 | 修正 | 検証項目 |
|---|---|---|
| 1 店舗条件は同一店舗 | 所在地・公開状態・利用状態を1店舗でAND。店舗ごとに matches_filter／matches_query、会社に matched_store_count を返す | G1〜G7（条件を2店舗で分担すると当たらない、等） |
| 2 登録途中を落とさない | 登録アカウント（profiles）基準。registration_state = completed／in_progress／no_profile、onboarding_step、状態フィルタ。サロン・運営者は除外。会社未作成のサロン登録者用RPCを追加 | H1〜H8、J1〜J3 |
| 3 診断・順序・役割確認 | mode='stylist'、created_at desc, id desc。詳細RPCは美容師アカウントか確認（運営者・サロンIDは not found） | I1〜I3、H8 |
| 4 想定した拒否のみPASS | 適用後チェックを PASS／FAIL／SKIP の表にして、FAILがあれば停止 | 上の表 |
| 5 実行権限の明示 | 全関数を public/anon/authenticated/service_role から revoke → 公開RPC5つだけ authenticated に grant。内部関数2つは付与なし。aclexplode で付与先を列挙して完全一致を確認 | K1〜K4、適用後チェック2・3 |

## 見える範囲・見えない範囲（既存データ）
- 会社一覧は salon_organizations に行がある会社のみ。会社が作られる前のサロン登録者は、admin_list_salon_registrants_without_company で確認する。
- profiles 行が無いアカウント（通常は発生しない）は一覧に出ない。
- profiles.role が既定値(stylist)のまま登録途中のサロン担当者は、役割で区別できないため美容師一覧に混ざり得る（登録時メタデータで役割を決める現行設計の限界）。
- 勤務希望地は自由記述で、書かれた都道府県名のみ絞り込みに使う（推測しない）。

## 未確認（本番）
本番DBでの実行、PostgREST経由のアプリからの呼び出し、運営者アカウントでの実画面表示、本番 auth.users.email_confirmed_at の存在（適用前チェックで確認）。

## アプリ側（ローカル）
ローカルコミット 92f4862（push していない）。tsc・lint エラー0、npm test 249件 PASS、next build 成功。0060 v2 が未適用の本番では、新しい画面は「取得できませんでした」と表示される（0件とは区別）。

## 項目別の結果（0060_verify.sql・86項目）
```
  1 | PASS | A1 anonは実行できない: select public.admin_list_organizations()
  2 | PASS | A2 一般利用者1は拒否: select public.admin_list_organizations()
  3 | PASS | A2 一般利用者2は拒否: select public.admin_list_organizations()
  4 | PASS | A2 一般利用者3は拒否: select public.admin_list_organizations()
  5 | PASS | A2 一般利用者4は拒否: select public.admin_list_organizations()
  6 | PASS | A1 anonは実行できない: select public.admin_get_organization('00
  7 | PASS | A2 一般利用者1は拒否: select public.admin_get_organization('00
  8 | PASS | A2 一般利用者2は拒否: select public.admin_get_organization('00
  9 | PASS | A2 一般利用者3は拒否: select public.admin_get_organization('00
 10 | PASS | A2 一般利用者4は拒否: select public.admin_get_organization('00
 11 | PASS | A1 anonは実行できない: select public.admin_list_stylists()
 12 | PASS | A2 一般利用者1は拒否: select public.admin_list_stylists()
 13 | PASS | A2 一般利用者2は拒否: select public.admin_list_stylists()
 14 | PASS | A2 一般利用者3は拒否: select public.admin_list_stylists()
 15 | PASS | A2 一般利用者4は拒否: select public.admin_list_stylists()
 16 | PASS | A1 anonは実行できない: select public.admin_get_stylist('0000000
 17 | PASS | A2 一般利用者1は拒否: select public.admin_get_stylist('0000000
 18 | PASS | A2 一般利用者2は拒否: select public.admin_get_stylist('0000000
 19 | PASS | A2 一般利用者3は拒否: select public.admin_get_stylist('0000000
 20 | PASS | A2 一般利用者4は拒否: select public.admin_get_stylist('0000000
 21 | PASS | A1 anonは実行できない: select public.admin_list_salon_registran
 22 | PASS | A2 一般利用者1は拒否: select public.admin_list_salon_registran
 23 | PASS | A2 一般利用者2は拒否: select public.admin_list_salon_registran
 24 | PASS | A2 一般利用者3は拒否: select public.admin_list_salon_registran
 25 | PASS | A2 一般利用者4は拒否: select public.admin_list_salon_registran
 26 | PASS | A3 sub無し(未ログイン相当)は拒否
 27 | PASS | B1 会社名で検索
 28 | PASS | B2 店舗名で検索→該当会社と、その店舗が行に含まれる
 29 | PASS | B3 登録メール（大文字小文字を区別しない）で検索
 30 | PASS | B4 店舗担当者名で検索→その店舗の会社
 31 | PASS | B5 % は特殊文字として働かない（全件にならない）
 32 | PASS | B6 都道府県(店舗の所在地)で絞り込み
 33 | PASS | B7 店舗プロフィールの所在地(東京都)が店舗側の値(null)より優先されて当たる
 34 | PASS | B8 大阪府の絞り込み（アルファは当たらず、ベータは当たる）
 35 | PASS | B9 所在地が未設定の店舗がある会社を「未設定」で絞り込める
 36 | PASS | B10 全店舗の所在地が設定済みの会社は「未設定」に出ない
 37 | PASS | B11 公開状態で絞り込み
 38 | PASS | B12 公開店が無い会社は公開で当たらない
 39 | PASS | B13 不正な絞り込み値は拒否
 40 | PASS | B14 件数は100に丸める
 41 | PASS | B15 limit=1 でも total は全体件数
 42 | PASS | C1 会社詳細: 全店舗(3)
 43 | PASS | C2 会社詳細: 店舗所在地の出どころ(profile/store/未設定)を区別
 44 | PASS | C3 会社詳細: 登録担当者(会社権限)と店舗担当者(店舗権限)を分けて返す
 45 | PASS | C4 会社詳細: 他社(ベータ)の担当者は混ざらない
 46 | PASS | C5 存在しない会社は not found
 47 | PASS | D1 美容師を名前で検索（公開名・本名）
 48 | PASS | D2 美容師をメールで検索
 49 | PASS | D3 居住地で絞り込み（勤務希望は無関係）
 50 | PASS | D4 勤務希望地で絞り込み（居住地が神奈川の さくら は当たらない）
 51 | PASS | D5 勤務希望: 東京都は さくら・あおい
 52 | PASS | D6 居住地「未設定」で絞り込み
 53 | PASS | D7 居住地・勤務希望が空でも行は出て、値はnull（画面で「未設定」）
 54 | PASS | D8 公開状態で絞り込み
 55 | PASS | E1 美容師詳細: 居住地と勤務希望を別項目で返す
 56 | PASS | E2 美容師詳細: 診断の回答・スコアの本文は返さない（タイプ名と日時のみ）
 57 | PASS | E3 美容師詳細: 年代・性別などは返さない
 58 | PASS | E4 運営者でも、サロン用アカウントのIDは美容師として引けない
 59 | PASS | G1 別々の店舗が条件を分担（北海道は非公開店/公開は東京店）しても「北海道かつ公開」に当たらない
 60 | PASS | G2 利用状態でも同様（北海道店は inactive、東京店が active）→当たらない
 61 | PASS | G3 所在地だけなら当たり、該当店舗は北海道店のみ matches_filter
 62 | PASS | G4 1店舗が全条件を満たす会社は当たり、その店舗が matches_filter（店舗プロフィールの所在地が優先）
 63 | PASS | G5 店舗名の検索では、検索語に一致した店舗が matches_query で分かる
 64 | PASS | G6 絞り込み無しなら matches_filter は全店舗 false（絞り込みが無いことを区別）
 65 | PASS | G7 「未設定」＋公開の同一店舗条件: 未設定店(不明店)は公開でないため当たらない店と、公開(渋谷)は所在地設定済のため、どの店も両方を満たさず当たらない
 66 | PASS | H1 アカウントのみ(プロフィール未作成)の美容師も一覧に残り no_profile
 67 | PASS | H2 登録途中(プロフィール有・未完了)は in_progress とステップ番号
 68 | PASS | H3 完了者は completed
 69 | PASS | H4 状態で絞り込める
 70 | PASS | H5 不正な状態値は拒否
 71 | PASS | H6 サロン・運営者のアカウントは美容師一覧に混ざらない
 72 | PASS | H7 プロフィールの無い美容師の詳細も引け、状態は no_profile
 73 | PASS | H8 運営者・サロン登録者のIDは美容師詳細で not found
 74 | PASS | I1 一覧の診断は mode=stylist のみ（新しいサロン用結果を拾わない）かつ同時刻は id 降順で固定（タイプB）
 75 | PASS | I2 詳細の診断も同じ（タイプB・サロン用は拾わない）
 76 | PASS | I3 繰り返しても結果が同じ（順序が安定）
 77 | PASS | J1 会社未作成のサロン登録者が出る（メール確認状態・ステップ付き）
 78 | PASS | J2 会社に所属済みのサロン・運営者・美容師は含まれない
 79 | PASS | J3 total が行数と一致
 80 | PASS | F1 5関数は読み取りのみ（STABLE）
 81 | PASS | F2 5関数とも SECURITY DEFINER・search_path固定
 82 | PASS | F3 内部関数 _admin_known_prefectures は一般利用者が呼べない
 83 | PASS | K1 公開RPC5つは authenticated のみ実行可（anon/service_role/PUBLICは不可）
 84 | PASS | K2 内部補助関数は誰にも実行権限が無い（所有者以外）
 85 | PASS | K3 service_role は公開RPCも内部関数も実行不可
 86 | PASS | K4 一般ユーザーは内部関数を直接呼べない（権限エラー）
```

## 適用前チェックの出力
```
 n  |                            name                             | result |               info               
----+-------------------------------------------------------------+--------+----------------------------------
  1 | 1 is_platform_admin が存在しSECURITY DEFINER                | PASS   | 1
  2 | 2 0060の関数が未作成                                        | PASS   | 
  3 | 3 列が存在: public.salon_organizations.name                 | PASS   | 
  4 | 3 列が存在: public.salon_organizations.status               | PASS   | 
  5 | 3 列が存在: public.salon_organizations.created_at           | PASS   | 
  6 | 3 列が存在: public.salon_stores.prefecture                  | PASS   | 
  7 | 3 列が存在: public.salon_stores.city                        | PASS   | 
  8 | 3 列が存在: public.salon_stores.usage_status                | PASS   | 
  9 | 3 列が存在: public.salon_stores.status                      | PASS   | 
 10 | 3 列が存在: public.salon_stores.store_name                  | PASS   | 
 11 | 3 列が存在: public.salon_store_profiles.prefecture          | PASS   | 
 12 | 3 列が存在: public.salon_store_profiles.city                | PASS   | 
 13 | 3 列が存在: public.salon_store_profiles.visibility          | PASS   | 
 14 | 3 列が存在: public.organization_members.role                | PASS   | 
 15 | 3 列が存在: public.store_members.role                       | PASS   | 
 16 | 3 列が存在: public.profiles.role                            | PASS   | 
 17 | 3 列が存在: public.profiles.onboarding_step                 | PASS   | 
 18 | 3 列が存在: public.user_roles.role                          | PASS   | 
 19 | 3 列が存在: public.stylist_profiles.prefecture              | PASS   | 
 20 | 3 列が存在: public.stylist_profiles.desired_work_location   | PASS   | 
 21 | 3 列が存在: public.stylist_profiles.public_name             | PASS   | 
 22 | 3 列が存在: public.stylist_profiles.visibility              | PASS   | 
 23 | 3 列が存在: public.stylist_private.full_name                | PASS   | 
 24 | 3 列が存在: public.diagnosis_results.mode                   | PASS   | 
 25 | 3 列が存在: public.diagnosis_results.type_name              | PASS   | 
 26 | 3 列が存在: public.diagnosis_results.type_id                | PASS   | 
 27 | 3 列が存在: public.stylist_evidence_documents.review_status | PASS   | 
 28 | 3 列が存在: public.store_hiring_processes.status            | PASS   | 
 29 | 3 列が存在: public.salon_profiles.user_id                   | PASS   | 
 30 | 3 列が存在: public.salon_onboarding_assignments.user_id     | PASS   | 
 31 | 3 列が存在: public.platform_admins.user_id                  | PASS   | 
 32 | 3 列が存在: auth.users.email                                | PASS   | 
 33 | 3 列が存在: auth.users.raw_user_meta_data                   | PASS   | 
 34 | 3 列が存在: auth.users.email_confirmed_at                   | PASS   | 
 35 | 4 platform_admins が1件以上                                 | PASS   | 1
 36 | 5 スナップショットのハッシュ（適用後と一致すること）        | INFO   | 4721c28c11a92efc7d1039b281b19457
(36 rows)
```

## 適用後チェックの出力
```
 n  |                                                   name                                                   | result |                                              info                                              
----+----------------------------------------------------------------------------------------------------------+--------+------------------------------------------------------------------------------------------------
  1 | 1 性質: admin_get_organization                                                                           | PASS   | secdef=t vol=s cfg={"search_path=public, pg_temp"}
  2 | 1 性質: admin_get_stylist                                                                                | PASS   | secdef=t vol=s cfg={"search_path=public, pg_temp"}
  3 | 1 性質: admin_list_organizations                                                                         | PASS   | secdef=t vol=s cfg={"search_path=public, pg_temp"}
  4 | 1 性質: admin_list_salon_registrants_without_company                                                     | PASS   | secdef=t vol=s cfg={"search_path=public, pg_temp"}
  5 | 1 性質: admin_list_stylists                                                                              | PASS   | secdef=t vol=s cfg={"search_path=public, pg_temp"}
  6 | 1 公開関数が5つ存在                                                                                      | PASS   | 5
  7 | 1 内部関数が2つ存在                                                                                      | PASS   | 2
  8 | 2 実行権限の付与先: _admin_is_stylist_account                                                            | PASS   | 付与先(所有者除く)=[] 期待=[(なし)]
  9 | 2 実行権限の付与先: _admin_known_prefectures                                                             | PASS   | 付与先(所有者除く)=[] 期待=[(なし)]
 10 | 2 実行権限の付与先: admin_get_organization                                                               | PASS   | 付与先(所有者除く)=[authenticated] 期待=[authenticated]
 11 | 2 実行権限の付与先: admin_get_stylist                                                                    | PASS   | 付与先(所有者除く)=[authenticated] 期待=[authenticated]
 12 | 2 実行権限の付与先: admin_list_organizations                                                             | PASS   | 付与先(所有者除く)=[authenticated] 期待=[authenticated]
 13 | 2 実行権限の付与先: admin_list_salon_registrants_without_company                                         | PASS   | 付与先(所有者除く)=[authenticated] 期待=[authenticated]
 14 | 2 実行権限の付与先: admin_list_stylists                                                                  | PASS   | 付与先(所有者除く)=[authenticated] 期待=[authenticated]
 15 | 2 service_role は公開関数を実行不可                                                                      | PASS   | 
 16 | 3a 一般利用者は拒否: select public.admin_list_organizations()                                            | PASS   | sqlstate=P0001 msg=admin access required
 17 | 3b anonは実行権限なし: select public.admin_list_organizations()                                          | PASS   | sqlstate=42501 msg=permission denied for function admin_list_organizations
 18 | 3c service_roleは実行権限なし: select public.admin_list_organizations()                                  | PASS   | sqlstate=42501 msg=permission denied for function admin_list_organizations
 19 | 3a 一般利用者は拒否: select public.admin_list_stylists()                                                 | PASS   | sqlstate=P0001 msg=admin access required
 20 | 3b anonは実行権限なし: select public.admin_list_stylists()                                               | PASS   | sqlstate=42501 msg=permission denied for function admin_list_stylists
 21 | 3c service_roleは実行権限なし: select public.admin_list_stylists()                                       | PASS   | sqlstate=42501 msg=permission denied for function admin_list_stylists
 22 | 3a 一般利用者は拒否: select public.admin_list_salon_registrants_without_company()                        | PASS   | sqlstate=P0001 msg=admin access required
 23 | 3b anonは実行権限なし: select public.admin_list_salon_registrants_without_company()                      | PASS   | sqlstate=42501 msg=permission denied for function admin_list_salon_registrants_without_company
 24 | 3c service_roleは実行権限なし: select public.admin_list_salon_registrants_without_company()              | PASS   | sqlstate=42501 msg=permission denied for function admin_list_salon_registrants_without_company
 25 | 3a 一般利用者は拒否: select public.admin_get_organization(gen_random_uuid())                             | PASS   | sqlstate=P0001 msg=admin access required
 26 | 3b anonは実行権限なし: select public.admin_get_organization(gen_random_uuid())                           | PASS   | sqlstate=42501 msg=permission denied for function admin_get_organization
 27 | 3c service_roleは実行権限なし: select public.admin_get_organization(gen_random_uuid())                   | PASS   | sqlstate=42501 msg=permission denied for function admin_get_organization
 28 | 3a 一般利用者は拒否: select public.admin_get_stylist(gen_random_uuid())                                  | PASS   | sqlstate=P0001 msg=admin access required
 29 | 3b anonは実行権限なし: select public.admin_get_stylist(gen_random_uuid())                                | PASS   | sqlstate=42501 msg=permission denied for function admin_get_stylist
 30 | 3c service_roleは実行権限なし: select public.admin_get_stylist(gen_random_uuid())                        | PASS   | sqlstate=42501 msg=permission denied for function admin_get_stylist
 31 | 3d 内部関数は直接呼べない                                                                                | PASS   | sqlstate=42501 msg=permission denied for function _admin_is_stylist_account
 32 | 4a 運営者: 会社一覧が返る                                                                                | PASS   | org total=13
 33 | 4b 運営者: 美容師一覧が返る                                                                              | PASS   | stylist total=3
 34 | 4c 運営者: 会社未作成のサロン登録者一覧が返る                                                            | PASS   | registrants total=3
 35 | 4d 運営者: 会社詳細が返る                                                                                | PASS   | 
 36 | 4e 運営者: 美容師詳細が返る                                                                              | PASS   | 
 37 | 5 スナップショットのハッシュ（適用前チェックの値と一致すること。行数が動く環境では権限部分の差のみ確認） | INFO   | 4721c28c11a92efc7d1039b281b19457
(37 rows)
 result | count 
--------+-------
 INFO   |     1
 PASS   |    36
(2 rows)
```
