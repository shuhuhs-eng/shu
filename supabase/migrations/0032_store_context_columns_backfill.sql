-- ============================================================================
-- Beauty Reach — 0032_store_context_columns_backfill
--
-- 法人・複数店舗対応 Phase 4 Step 2。既存の履歴/イベント系テーブル
-- （scouts / salary_offers / stylist_salon_interests）へ、将来の複数店舗
-- 対応に必要な列（store_id・created_by_user_id）だけを追加する。
--
-- ★今回のスコープ（厳守）:
--   ・列追加（すべてNULL許容）＋ FK ＋ GV既存データbackfill ＋ 必要最小限の
--     indexのみ。
--   ・既存RLS・既存RPC（send_scout/respond_scout/mark_scout_read/
--     get_public_stylists_for_scout/create_salary_offer/
--     respond_salary_offer/set_salon_interest等）は一切変更しない
--     （create or replaceしない）。
--   ・既存unique制約（salary_offers_one_pending_per_pair）・既存PK
--     （stylist_salon_interests: stylist_user_id, salon_user_id）は
--     今回変更しない。store単位への移行は後続migrationで行う。
--   ・既存salon_user_id/stylist_user_id列はいずれも削除・変更しない。
--   ・app/lib/components/typesは一切変更しない。
--   ・既存migration(0001〜0031)は一切編集していない。
--
-- ★NOT NULL化は今回一切行わない（本migration全体を通じて、追加する列は
-- すべてnullable のまま）。既存RPCがstore_id/created_by_user_idを渡さずに
-- INSERTを続けても、何も壊れないことを構造的に保証する。
--
-- ★ON DELETE方針（store_id/created_by_user_id共通でSET NULLを採用した
-- 理由）:
--   既存のscouts.salon_user_id/stylist_user_id、salary_offers.salon_user_id/
--   stylist_user_id、stylist_salon_interests.stylist_user_id/salon_user_id
--   はいずれも「この行が何を表しているか」を定義する一次キーであり、
--   auth.users側がon delete cascadeになっている（本人が退会すれば、
--   その履行記録自体の存在意義も失われるため、行ごと削除される設計）。
--   一方、今回追加するstore_id/created_by_user_idは「どの店舗からの
--   採用活動か」「実際にボタンを押した担当者は誰か」という**付加的な
--   文脈情報**であり、この行が表す一次的な関係（誰と誰の間のScout/Offer/
--   Interestか）を定義するものではない。そのため、店舗が削除されたり
--   担当者アカウントが削除されたりしても、履歴そのもの（salon_user_id/
--   stylist_user_id側の行）は消えるべきではなく、文脈情報だけがNULLに
--   戻るべきと判断した（ON DELETE CASCADEにすると、店舗の削除や担当者の
--   退職・異動という「本来の履行主体(salon_user_id)とは無関係な出来事」
--   によって、過去のScout/Offer/Interest履行記録そのものが消えてしまう。
--   これは既存salon_user_id/stylist_user_idが持つ「本人退会時のみ消える」
--   という一次キーの性質とは異なる）。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. scouts へ store_id / created_by_user_id を追加
-- ----------------------------------------------------------------------------
alter table public.scouts
  add column store_id uuid references public.salon_stores(id) on delete set null,
  add column created_by_user_id uuid references auth.users(id) on delete set null;
comment on column public.scouts.store_id is '法人・複数店舗対応 Phase 4。このScoutがどの店舗からの採用活動かを表す文脈情報。NULL許容（既存send_scout()はまだこの列を渡さない）。店舗削除時はSET NULL（履歴行自体は残す）。';
comment on column public.scouts.created_by_user_id is '法人・複数店舗対応 Phase 4。実際にScoutを送信した担当者(auth.uid())。NULL許容。salon_user_idとは別軸（将来、salon_user_id=会社代表者とは異なる担当者が送信するケースに対応するための列）。担当者アカウント削除時はSET NULL。';

-- ----------------------------------------------------------------------------
-- 2. salary_offers へ store_id / created_by_user_id を追加
-- ----------------------------------------------------------------------------
alter table public.salary_offers
  add column store_id uuid references public.salon_stores(id) on delete set null,
  add column created_by_user_id uuid references auth.users(id) on delete set null;
comment on column public.salary_offers.store_id is '法人・複数店舗対応 Phase 4。このオファーがどの店舗からの採用活動かを表す文脈情報。NULL許容（既存create_salary_offer()はまだこの列を渡さない）。既存salary_offers_one_pending_per_pair（salon_user_id, stylist_user_id単位）は今回変更しない。店舗削除時はSET NULL。';
comment on column public.salary_offers.created_by_user_id is '法人・複数店舗対応 Phase 4。実際にオファーを作成した担当者(auth.uid())。NULL許容。salon_user_idとは別軸。担当者アカウント削除時はSET NULL。';

-- ----------------------------------------------------------------------------
-- 3. stylist_salon_interests へ store_id を追加
-- ----------------------------------------------------------------------------
alter table public.stylist_salon_interests
  add column store_id uuid references public.salon_stores(id) on delete set null;
comment on column public.stylist_salon_interests.store_id is '法人・複数店舗対応 Phase 4。この意思表示がどの店舗宛かを表す文脈情報。NULL許容（既存set_salon_interest()はまだこの列を渡さない）。既存PK(stylist_user_id, salon_user_id)は今回変更しない。店舗削除時はSET NULL。';

-- ----------------------------------------------------------------------------
-- 4. GV既存データのbackfill。
--
-- canonical mappingはpublic.salon_onboarding_assignments（user_id PK×
-- organization_id×store_id）のみを使う。legacy_salon_user_idは使わない。
--
-- salon_onboarding_assignmentsはuser_id PKのため、1ユーザーにつき
-- store_idは常に初期店舗の1件のみ。2店舗目以降の店舗を表す行は
-- そもそもここに存在しないため、既存scouts/salary_offers/
-- stylist_salon_interestsの行がJOINできるのは「初期店舗のオーナーが
-- 送受信した行」のみに構造的に限定される（2店舗目以降は、現時点で
-- それを表す旧salon_user_idベースの行自体が存在しないため、今回の
-- backfillはそもそも対象にしない、という前提と一致する）。
--
-- マッピングが無い行（salon_onboarding_assignmentsにJOINできない行）は
-- store_id/created_by_user_idともにNULLのまま残る。migrationはこれを
-- エラーとせず、正常に完了する。
-- ----------------------------------------------------------------------------
update public.scouts s
set store_id = soa.store_id,
    created_by_user_id = s.salon_user_id
from public.salon_onboarding_assignments soa
where soa.user_id = s.salon_user_id;

update public.salary_offers so
set store_id = soa.store_id,
    created_by_user_id = so.salon_user_id
from public.salon_onboarding_assignments soa
where soa.user_id = so.salon_user_id;

update public.stylist_salon_interests ssi
set store_id = soa.store_id
from public.salon_onboarding_assignments soa
where soa.user_id = ssi.salon_user_id;

-- ----------------------------------------------------------------------------
-- 5. index（店舗単位検索に備えた最小限のみ）。
--
-- 既存scouts/salary_offers/stylist_salon_interestsには、salon_user_id/
-- stylist_user_id単体のindexがそもそも存在しない（PK・部分unique index
-- 以外は0018/0022/0025のいずれも作成していない）。今回新設するstore_id/
-- created_by_user_id列についてのみ、将来の店舗単位検索に備えて追加する
-- （既存列への新規indexは今回のスコープ外、重複indexも作らない）。
-- ----------------------------------------------------------------------------
create index scouts_store_id_idx on public.scouts(store_id);
create index scouts_created_by_user_id_idx on public.scouts(created_by_user_id);
create index salary_offers_store_id_idx on public.salary_offers(store_id);
create index salary_offers_created_by_user_id_idx on public.salary_offers(created_by_user_id);
create index stylist_salon_interests_store_id_idx on public.stylist_salon_interests(store_id);

commit;
