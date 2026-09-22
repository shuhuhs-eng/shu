-- ============================================================================
-- Beauty Reach — 0016_public_salon_photos_storage_policy
--
-- 美容師向けサロン詳細画面（/stylist/salons/[salonUserId]）のPHOTOセクションで
-- 画像本体が表示されない不具合の修正。
--
-- ★原因: 0014で作成した salon-photos バケットのStorage SELECTポリシーは
-- salon_photos_storage_select_own（本人のフォルダのみ）の1本のみで、
-- 美容師（他人）がPUBLICサロンの写真に対して createSignedUrl() を呼んでも
-- RLSにより拒否され、signedUrl が常に null になっていた（枠は
-- get_public_salon_photos RPCで正しく取得できるため表示されるが、
-- 画像本体だけが読み込めず真っ白になる）。0015で avatars バケットには
-- 同様の「PUBLICサロンの分だけstylistに読ませる」ポリシー
-- （avatars_select_public_salon_logo）を追加していたが、salon-photos
-- バケットには相当するポリシーが無かったための見落とし。
--
-- ★重要: 0015_salon_links.sql は既にSupabase本番へ適用済みのため、
-- このmigrationでは絶対に編集しない。今回の修正は完全に新規のmigration
-- （このファイル）として追加する。
--
-- ★既存の0010〜0015のmigration・0014のStorage policy4本・salon_photos
-- テーブル・salon-photosバケット設定（public:false含む）・アップロード/
-- 削除処理・get_public_salon_photos RPC・matching計算は一切変更しない。
-- 新規SELECT policyを1本だけ追加する。
-- ============================================================================

create policy salon_photos_storage_select_public_salon on storage.objects
  for select using (
    bucket_id = 'salon-photos'
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id = auth.uid() and ur.role = 'stylist'
    )
    and exists (
      select 1 from public.salon_profiles sp
      where sp.user_id::text = (storage.foldername(name))[1]
        and sp.visibility = 'PUBLIC'
    )
  );
comment on policy salon_photos_storage_select_public_salon on storage.objects is '0016: salon-photosバケットのうち、対象オブジェクトのpath第1階層（salon_user_id）が属するサロンがvisibility=PUBLICの場合に限り、ログイン済みのstylist roleユーザーにSELECT（createSignedUrl発行の前提）を許可する。PRIVATE/LIMITEDサロンの写真、およびstylist以外の認証ユーザーはこのポリシーの対象外。既存の salon_photos_storage_select_own（0014、本人のみ）はそのまま維持されており、このポリシーはOR条件として追加されるだけ（サロン本人は引き続き従来どおり自分の写真をSELECTできる）。salon_photosテーブル自体・そのRLS・アップロード/削除に関する既存3ポリシー（insert_own/update_own/delete_own）・バケット設定（public:false含む）は一切変更していない。';
