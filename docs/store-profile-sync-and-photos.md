# 店舗プロフィールの保存先・同期と、写真の保存単位（実コード確認の記録）

## 保存先・参照先
| 画面 | 参照先 | 保存先 |
|---|---|---|
| サロンマイページ「サロン概要」 | salon_profiles（旧・サロン本人単位） | — |
| 「サロンプロフィールを編集」(/salon/profile) | salon_profiles | save_salon_profile → salon_profiles（初回のみ会社・店舗・対応表を作成。salon_store_profiles は作らない） |
| 店舗プロフィール編集 (/salon/stores/[storeId]/profile) | salon_store_profiles | save_salon_store_profile → salon_store_profiles |
| プレビュー (/salon/stores/[storeId]/preview) | salon_stores / salon_store_profiles / salon_store_culture_profiles（RLS: is_store_accessible） | なし（読み取り専用） |
| 美容師向け詳細 (/stylist/salons/[storeId]) | get_public_salon_store_detail（公開中の店舗のみ） | なし |

## 同期（0030 の仕様どおり。自動同期の追加はしていない）
- 店舗プロフィール保存 → 旧 salon_profiles へ同期されるのは「初期店舗」（salon_onboarding_assignments に載る店舗）のみ。2店舗目以降は同期されない。
- 旧プロフィール保存（save_salon_profile）→ 店舗プロフィールへは同期されない。新規サロンの初回保存では、店舗は作られるが salon_store_profiles の行は作られない。
- ローカルDBでの確認: 店舗保存→取得SQLに反映／別店舗は不変／初期店舗のみ旧へ同期／2店舗目は旧へ同期されない／旧保存は店舗プロフィールを更新しない／初回の旧保存で店舗プロフィール行は0件。
- 影響: 旧プロフィールだけを編集していた（または新規登録だけした）サロンは、店舗プロフィールが未保存＝美容師に表示されない可能性がある（本番データでは未確認）。

## 写真（salon_photos）
- 保存単位はサロン本人（salon_user_id）。store_id 列はない。Storage の配置も本人フォルダ。
- 読み取り: テーブルRLSは本人のみ。同じ店舗の店長でも読めない。公開用 get_public_salon_photos(salon_user_id) は美容師ロール専用で、旧 salon_profiles の公開設定を見る。Storage ポリシー(0016)も旧公開設定を見る。
- 店舗→写真の対応を美容師が読める仕組みはない（対応表 salon_onboarding_assignments は本人のみ）。
- 現状、美容師向け店舗詳細は写真を表示していない（getPublicSalonPhotos は定義のみで、どの画面からも呼ばれていない）。
- 方針: 実在しない公開経路をプレビューだけに足すと、美容師に見えないものを見せることになるため、今回は写真を追加していない。

## DB変更の案（未適用・承認待ち）
1. 写真の店舗単位化: salon_photos に store_id を追加（既存行は初期店舗へバックフィル）、または新テーブル salon_store_photos。保存RPC・アップロード画面を店舗単位に。
2. 公開取得: get_public_store_photos(store_id) を新設（美容師ロール・店舗が PUBLIC の場合のみ、その店舗の写真パスだけを返す）。Storage に「その店舗が PUBLIC のとき美容師が閲覧可」のポリシーを追加（0016 は旧公開設定を見る点を見直す）。
3. サロン側プレビュー用: 店舗メンバーが同店舗の写真を読めるよう、store_id 基準の SELECT ポリシー（is_store_accessible）を追加。
4. 店舗プロフィール未保存サロンの救済: 旧プロフィールから店舗プロフィールを一度だけ作るバックフィル、または旧保存時に店舗プロフィール行がなければ作る処理（いずれも既存データの扱いを決めてから）。
