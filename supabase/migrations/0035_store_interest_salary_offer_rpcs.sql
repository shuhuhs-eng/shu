-- ============================================================================
-- Beauty Reach — 0035_store_interest_salary_offer_rpcs
--
-- 法人・複数店舗対応 Phase 4 Step 5。Interest/Salary OfferのstoreID対応。
--
-- ★実装前に確認した現行schema/RPCの完全な仕様（この前提に基づいて設計）:
--
-- [stylist_salon_interests] (0018作成、0032でstore_id列を追加。以後無変更)
--   columns: stylist_user_id uuid not null / salon_user_id uuid not null
--     (いずれもFK→auth.users(id) on delete cascade) / created_at timestamptz
--     not null default now() / store_id uuid null (0032、FK→salon_stores(id)
--     on delete set null)
--   PK: primary key (stylist_user_id, salon_user_id)（0018でCREATE TABLE内に
--     無名指定＝Postgres標準命名規則により実際の制約名は
--     stylist_salon_interests_pkey）
--   CHECK: stylist_salon_interests_different_users
--     (stylist_user_id <> salon_user_id)
--   RLS: stylist_salon_interests_select_sent_own
--     (stylist_user_id = auth.uid())のみ。salon側の直接SELECTポリシーは
--     存在しない（サロン側はget_received_salon_interests() RPC経由のみ）。
--   FK被参照調査: 他テーブルからこのテーブルのPKを参照するFKは存在しない
--     （全migrationをgrep済み、0件）。
--
-- [salary_offers] (0022作成、0032でstore_id/created_by_user_id列を追加。
--   以後schema無変更)
--   columns: id uuid PK / salon_user_id・stylist_user_id uuid not null
--     (FK→auth.users on delete cascade) / monthly_guarantee・
--     performance_addition・guarantee_months・performance_condition・
--     salon_message・status・response_reason・response_note・responded_at・
--     created_at・updated_at（0022） / store_id・created_by_user_id uuid
--     null（0032、FK→salon_stores(id)/auth.users(id) on delete set null）
--   既存unique index: salary_offers_one_pending_per_pair（0022で明示的に
--     この名前で作成。推測ではない）on (salon_user_id, stylist_user_id)
--     where status = 'pending'
--   RLS: salary_offers_select_participant
--     (salon_user_id = auth.uid() or stylist_user_id = auth.uid())
--
-- [現行RPC（いずれも最新のcreate or replaceが0024時点であることを確認済み。
--   以後0025〜0034で再定義されていない）]
--   set_salon_interest(p_salon_user_id uuid, p_interested boolean) returns
--     boolean: auth確認→caller role=stylist→target salon role=salon かつ
--     salon_profiles.visibility='PUBLIC'→true時はinsert...on conflict
--     (stylist_user_id, salon_user_id) do nothing（新規insert成功時のみ
--     create_notification呼び出し）→false時はdelete。
--   create_salary_offer(p_stylist_user_id, p_monthly_guarantee,
--     p_performance_addition, p_guarantee_months, p_performance_condition,
--     p_salon_message) returns public.salary_offers: caller role=salon→
--     stylist_salon_interests(salon_user_id=v_uid, stylist_user_id=target)
--     の存在確認（'interest required'）→stylist_match_profiles.
--     wants_performance_offer and verification_status='verified'の存在確認
--     （'verified opt-in profile required'）→performance_addition>0なら
--     performance_condition必須→insert（pending重複はRPC内で明示チェック
--     せず、salary_offers_one_pending_per_pair unique indexの違反として
--     DBが自然に拒否する設計）→成功時create_notification。
--   respond_salary_offer(p_offer_id, p_response, p_reason, p_note) returns
--     public.salary_offers: stylist_user_id=auth.uid()かつstatus='pending'
--     の行のみ更新（store_id/salon_user_idは一切参照しない。v2で作成された
--     Offerにも無変更でそのまま使える）。
--
-- ★今回の方針: 上記3RPCはいずれもcreate or replaceしない（無変更）。
-- 新規にset_store_interest()・create_salary_offer_v2()を追加し、既存の
-- ビジネスルール（対象確認・evidence/verification条件・pending重複防止・
-- 通知有無）は一切変更しない。store対応に必要な差分のみを加える。
--
-- ★追加（互換性修正）: 0032でstore_idがbackfill済みの既存pending Offerと、
-- 無変更の旧create_salary_offer()が新たに作るstore_id=NULLの行とが、別々の
-- partial unique indexに分かれて重複検出を素通りしてしまう問題に対応する
-- ため、salary_offersへBEFORE INSERT trigger
-- (backfill_legacy_salary_offer_store_context) を追加する（詳細は3参照）。
-- 既存create_salary_offer()自体は1文字も変更しない。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. stylist_salon_interestsの制約移行。
--
-- 旧複合PK (stylist_user_id, salon_user_id) のままでは、
-- 「salon_user_idを持たないstore単位のInterest」を表現できない
-- （salon_user_idがnot nullのため）。surrogate idへ主キーを移行し、
-- salon_user_idをnullable化する。
--
-- 既存バックフィル行（0032でstore_idが設定済みのGV分）は
-- salon_user_id・store_idの両方が non-null のままであり、以下で新設する
-- legacy unique（非partial）・store unique（partial）のどちらにも安全に
-- 適合する（既存1行のみのため衝突は発生しない）。
--
-- ★重要（ON CONFLICT推論の制約）: 既存set_salon_interest()は無変更のまま
-- `insert ... on conflict (stylist_user_id, salon_user_id) do nothing`を
-- 使用している。PostgreSQLのON CONFLICT (columns)は、WHERE句を伴わない
-- 指定の場合、対象となるunique制約/indexもWHERE句を持たない（非partialな）
-- ものでなければ推論できない（partial unique indexを対象にするには、
-- INSERT文のON CONFLICT自体に同じWHERE句を明示する必要があり、既存
-- set_salon_interest()はそれを持たない）。そのため、salon_user_id側は
-- 「WHERE句の無い通常のUNIQUE制約」として作る（store_id側は新設の
-- set_store_interest()が明示的にWHERE句付きON CONFLICTを使うため、
-- partial unique indexのままでよい）。salon_user_idはnullable化済みだが、
-- PostgreSQLのUNIQUE制約はNULLを含む列について「NULLは互いに重複と
-- みなさない」という標準SQL仕様があるため、salon_user_id=NULLの
-- store単位Interestが何行あってもこのUNIQUE制約には抵触しない
-- （stylist_user_idが同じでもsalon_user_idがNULLどうしは別物として扱われる）。
-- ----------------------------------------------------------------------------

-- 1a. surrogate id追加。gen_random_uuid()は volatile なデフォルトのため、
-- ADD COLUMNは既存行を書き換えて各行に一意なidを割り当てる
-- （PostgreSQLの標準動作。既存行数が少ないため問題ない）。
alter table public.stylist_salon_interests
  add column id uuid not null default gen_random_uuid();

-- 1b. 旧PKを削除する。CREATE TABLE内の無名primary key指定はPostgreSQLの
-- 標準命名規則により常に{table}_pkeyという名前になるが、ここでは推測せず
-- pg_constraintから実際の制約名を取得してからdropする（制約名が想定と
-- 異なる、または見つからない場合はraise exceptionでmigration全体を
-- 停止し、黒く処理を続けない）。
do $$
declare
  v_pk_name text;
begin
  select conname into v_pk_name
  from pg_constraint
  where conrelid = 'public.stylist_salon_interests'::regclass
    and contype = 'p';

  if v_pk_name is null then
    raise exception 'stylist_salon_interests: no primary key constraint found, aborting migration';
  end if;

  execute format('alter table public.stylist_salon_interests drop constraint %I', v_pk_name);
end $$;

-- 1c. salon_user_idをnullable化し、idを新しいPKにする。
alter table public.stylist_salon_interests
  alter column salon_user_id drop not null,
  add primary key (id);

-- 1d. 新しいunique制約/index。
--   A. 旧互換Interest: (stylist_user_id, salon_user_id)の通常の
--      （非partial）UNIQUE制約。既存set_salon_interest()の
--      `on conflict (stylist_user_id, salon_user_id)`（WHERE句なし）が
--      そのまま推論できる唯一の形。salon_user_id=NULLの行同士は
--      PostgreSQLの標準NULL比較規則により重複と判定されないため、
--      store単位Interest（salon_user_id=NULL）を何行作ってもこの制約には
--      抵触しない。
--   B. store Interest: salon_user_idを見ないstore_id単位のpartial unique
--      index。store_idが設定されている場合のみ一意（新設の
--      set_store_interest()がON CONFLICT句にも同じWHERE句を明示するため、
--      正しく推論される）。
-- 既存バックフィル行（salon_user_id・store_id両方non-null）はA・Bいずれの
-- 条件にも単独で適合するため、作成自体が失敗する余地はない
-- （万一重複があればADD CONSTRAINT/CREATE UNIQUE INDEXがDB側で自然に
-- 失敗し、migration全体がロールバックされる）。
alter table public.stylist_salon_interests
  add constraint stylist_salon_interests_legacy_unique
  unique (stylist_user_id, salon_user_id);

create unique index stylist_salon_interests_store_unique
  on public.stylist_salon_interests (stylist_user_id, store_id)
  where store_id is not null;

-- 1e. salon_user_id・store_idが両方NULLという意味不明な行を防ぐCHECK。
-- 既存行はすべて両方non-nullのバックフィル済み行のため違反しない。
alter table public.stylist_salon_interests
  add constraint stylist_salon_interests_salon_or_store_required
  check (salon_user_id is not null or store_id is not null);

comment on column public.stylist_salon_interests.id is '法人・複数店舗対応 Phase 4。surrogate PK。旧複合PK(stylist_user_id, salon_user_id)はこの移行で廃止した。';
comment on column public.stylist_salon_interests.salon_user_id is '旧互換列（nullable化済み）。store単位Interest（set_store_interest()経由）ではNULLのまま保存する。旧set_salon_interest()はこの列のみ使用し続ける。';

-- ----------------------------------------------------------------------------
-- 2. salary_offersのpending unique制約移行。
--
-- 旧salary_offers_one_pending_per_pair（(salon_user_id, stylist_user_id)
-- where status='pending'）のままだと、同じ担当者(salon_user_id)が複数の
-- 異なるstoreから同じ美容師へpending offerを出せない（store_idの違いを
-- 一切見ないため）。store_idの有無で2つのpartial unique indexへ分離する。
--
-- ★名前を推測しない: 旧indexの名前はこのmigrationで新規に決めるのではなく、
-- 0022で明示的にこの名前(salary_offers_one_pending_per_pair)で作成された
-- ことをソースコード(0022_performance_salary_offers.sql)で確認済み。
-- 念のため、DROP実行前に実在確認を行い、見つからない場合はmigration全体を
-- 停止する。
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'salary_offers_one_pending_per_pair'
  ) then
    raise exception 'salary_offers: expected index salary_offers_one_pending_per_pair not found, aborting migration';
  end if;
end $$;

drop index public.salary_offers_one_pending_per_pair;

-- 旧互換: store_idが設定されていない（＝旧create_salary_offer経由）行のみ対象。
create unique index salary_offers_legacy_one_pending_per_pair
  on public.salary_offers (salon_user_id, stylist_user_id)
  where status = 'pending' and store_id is null;

-- store版: store_idが設定されている（＝create_salary_offer_v2経由）行のみ対象。
create unique index salary_offers_store_one_pending_per_pair
  on public.salary_offers (store_id, stylist_user_id)
  where status = 'pending' and store_id is not null;

-- ----------------------------------------------------------------------------
-- 3. 旧create_salary_offer()経由のpending重複を防ぐためのBEFORE INSERT
-- trigger（既存create_salary_offer()自体はcreate or replaceしない）。
--
-- ★問題: 0032でbackfillされた既存pending Offer（例: GV, store_id=初期店舗ID
-- 設定済み）はsalary_offers_store_one_pending_per_pairの対象。一方、
-- 既存create_salary_offer()は無変更のためstore_idを常にNULLで保存する。
-- そのため、同じ(salon_user_id, stylist_user_id)へ旧routeから再度Offerを
-- 作成すると、新しい行はstore_id is nullのlegacy indexの対象になり、
-- store側の既存行とは別indexとして扱われるため重複を検出できない
-- （「旧routeでは同一salon_user×stylistのpending重複を防ぐ」という
-- 既存要件を満たせなくなる）。
--
-- ★解決方針: INSERT時にNEW.store_idがNULLの場合のみ、
-- salon_onboarding_assignments（canonical mapping、legacy_salon_user_idは
-- 使わない）からNEW.salon_user_idに対応するstore_idを調べ、見つかれば
-- NEW.store_idへ補完する。これにより、GVのような「canonical mappingを
-- 持つ既存ユーザー」が旧routeから送るOfferは、backfill済みの既存行と
-- 同じstore_idを持つことになり、salary_offers_store_one_pending_per_pair
-- が正しく重複を検出する。
--
-- ★安全性:
--   ・NEW.store_idが既に設定されている場合（create_salary_offer_v2経由）は
--     一切上書きしない（if new.store_id is null の条件でガード）。
--   ・salon_onboarding_assignmentsはuser_id PKのため、1ユーザーにつき
--     store_idは常に0件か1件のみ。2店舗目を推測する余地が無い
--     （複数店舗を持つユーザーでも、ここで補完されるのは必ず
--     「本人が初回オンボーディングで作成した店舗」のみ）。
--   ・mappingが存在しないsalon_user_id（canonical mappingを持たない
--     ユーザー）はNEW.store_idがNULLのまま保持され、従来どおり
--     salary_offers_legacy_one_pending_per_pair（store_id is null側）で
--     重複防止される。
--   ・既存行への影響は無い（BEFORE INSERTのみ、UPDATEトリガーは追加して
--     いないため、既存のstore_idがNULLへ戻ることも消えることもない）。
--   ・created_by_user_idがNULLの場合（＝旧create_salary_offer()経由、
--     v2は必ずv_uidを設定するため常にNULLではない）のみ、
--     NEW.salon_user_idから補完する（0032の既存backfillと同じ対応関係）。
-- ----------------------------------------------------------------------------
create or replace function public.backfill_legacy_salary_offer_store_context()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_store_id uuid;
begin
  if new.store_id is null then
    select store_id into v_store_id
    from public.salon_onboarding_assignments
    where user_id = new.salon_user_id;

    if v_store_id is not null then
      new.store_id := v_store_id;
    end if;
  end if;

  if new.created_by_user_id is null then
    new.created_by_user_id := new.salon_user_id;
  end if;

  return new;
end;
$$;
comment on function public.backfill_legacy_salary_offer_store_context is '法人・複数店舗対応 Phase 4。旧create_salary_offer()（無変更）がstore_idを渡さずINSERTした場合のみ、salon_onboarding_assignments（canonical mapping。legacy_salon_user_idは使わない）からNEW.salon_user_idの初期店舗store_idを補完するBEFORE INSERT trigger。create_salary_offer_v2が明示したstore_idは一切上書きしない。mappingが無いユーザーはstore_id=NULLのまま。';

create trigger trg_salary_offers_backfill_legacy_store_context
  before insert on public.salary_offers
  for each row execute function public.backfill_legacy_salary_offer_store_context();

-- ----------------------------------------------------------------------------
-- 4. set_store_interest(): store単位Interest送信。
--
-- 既存set_salon_interest()と同じ戻り値形式（boolean = p_interested）に
-- 合わせる。salon_user_idは無理に埋めない（NULLのまま保存。所有者を
-- company_owner等へ推測変換しない）。
--
-- ★通知: 今回は接続しない（既存set_salon_interest()のcreate_notification
-- 呼び出しはstore版には追加しない。指示どおり後続で整理する）。
-- ----------------------------------------------------------------------------
create or replace function public.set_store_interest(
  p_store_id uuid,
  p_interested boolean
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stylist_uid uuid := auth.uid();
begin
  if v_stylist_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.user_roles
    where user_id = v_stylist_uid and role = 'stylist'
  ) then
    raise exception 'caller is not a stylist';
  end if;

  if not exists (
    select 1 from public.salon_store_profiles
    where store_id = p_store_id and visibility = 'PUBLIC'
  ) then
    raise exception 'target store is not public';
  end if;

  if p_interested then
    -- ★on conflictは1dで作成したpartial unique index
    -- (stylist_user_id, store_id) where store_id is not null を明示的に
    -- 対象にする。既存バックフィル行（salon_user_id設定済み）に対しても
    -- 正しくマッチし、salon_user_idを書き換えずにそのまま重複を防止する。
    insert into public.stylist_salon_interests (stylist_user_id, store_id)
    values (v_stylist_uid, p_store_id)
    on conflict (stylist_user_id, store_id) where store_id is not null do nothing;
  else
    -- ★store_idのみで削除対象を特定する。バックフィル済み行
    -- （salon_user_id・store_id両方が設定済み）もこれで正しく削除できる。
    delete from public.stylist_salon_interests
    where stylist_user_id = v_stylist_uid
      and store_id = p_store_id;
  end if;

  return p_interested;
end;
$$;
comment on function public.set_store_interest is '店舗単位「話を聞いてみたい」の送信・取消（法人・複数店舗対応 Phase 4）。stylist_user_id=auth.uid()・store_id=p_store_idのみで一意に特定し、salon_user_idは埋めない（NULLのまま。company_owner等への推測変換は行わない）。既存set_salon_interest()は無変更。通知は今回接続しない。';

revoke all on function public.set_store_interest(uuid, boolean) from public, anon;
grant execute on function public.set_store_interest(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. create_salary_offer_v2(): store単位給与オファー作成。
--
-- actor(auth.uid()) / store(p_store_id、is_store_accessible()でのみ判定) /
-- target(p_stylist_user_id)を分離する。Interest確認はstore_id単位
-- （stylist_salon_interests.store_id = p_store_id）で行い、salon_user_idは
-- 一切見ない。evidence/verification条件（wants_performance_offer and
-- verification_status='verified'）・performance_condition必須条件は
-- 既存create_salary_offer()と完全に同一のまま維持する。
--
-- ★既存との差分: 認証チェックを明示的なauth.uid() is null判定として追加
-- している（既存create_salary_offer()はこの判定を独立して持たず、
-- 未認証の場合も結果的に次のrole確認で'caller is not a salon'として
-- 拒否される。v2ではSECURITY定義の明確化のため分離したが、未認証呼び出しが
-- 拒否されるという結果自体は既存と同じで、ビジネスルールの変更はない）。
--
-- pending重複防止は既存と同じ設計思想で、RPC内で明示チェックせず、
-- 2で新設したsalary_offers_store_one_pending_per_pair unique indexの
-- 違反としてDBが自然に拒否する（既存create_salary_offer()が
-- salary_offers_one_pending_per_pair違反に依っているのと対称）。
-- ----------------------------------------------------------------------------
create or replace function public.create_salary_offer_v2(
  p_store_id uuid,
  p_stylist_user_id uuid,
  p_monthly_guarantee integer,
  p_performance_addition integer,
  p_guarantee_months integer,
  p_performance_condition text,
  p_salon_message text
) returns public.salary_offers
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.salary_offers;
  v_condition text := nullif(trim(coalesce(p_performance_condition, '')), '');
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;

  -- ★店舗アクセス権はis_store_accessible()のみで判定する。
  -- auth.uid() = store_idという扱いは一切しない。
  if not public.is_store_accessible(p_store_id) then
    raise exception 'store not found or not accessible';
  end if;

  -- ★Interest確認はstore単位（salon_user_idは見ない）。0032で
  -- backfill済みの初期店舗Interestもstore_idが設定済みのため、
  -- そのままこの前提条件として認識できる。
  if not exists (
    select 1 from public.stylist_salon_interests
    where store_id = p_store_id and stylist_user_id = p_stylist_user_id
  ) then
    raise exception 'interest required';
  end if;

  -- ★既存create_salary_offer()と完全に同一のevidence/verification条件。
  if not exists (
    select 1 from public.stylist_match_profiles
    where stylist_user_id = p_stylist_user_id
      and wants_performance_offer
      and verification_status = 'verified'
  ) then
    raise exception 'verified opt-in profile required';
  end if;

  if coalesce(p_performance_addition, 0) > 0 and v_condition is null then
    raise exception 'performance condition required when performance addition is greater than zero';
  end if;

  -- ★actor/store/targetを明確に分離して保存する。
  --   salon_user_id      = v_uid（旧互換のため、NULLにしない）
  --   created_by_user_id = v_uid（実際にこのRPCを呼んだ担当者）
  --   store_id           = p_store_id（採用活動の主体）
  insert into public.salary_offers (
    salon_user_id, stylist_user_id, monthly_guarantee, performance_addition,
    performance_condition, guarantee_months, salon_message,
    store_id, created_by_user_id
  ) values (
    v_uid, p_stylist_user_id, p_monthly_guarantee, coalesce(p_performance_addition, 0),
    v_condition, p_guarantee_months, nullif(trim(coalesce(p_salon_message, '')), ''),
    p_store_id, v_uid
  )
  returning * into v_row;

  return v_row;
end;
$$;
comment on function public.create_salary_offer_v2 is '店舗単位給与オファー作成（法人・複数店舗対応 Phase 4）。actor(auth.uid())/store(p_store_id、is_store_accessible()でのみアクセス判定)/target(p_stylist_user_id)を分離する。Interest確認・evidence/verification条件（wants_performance_offer and verification_status=verified）・performance_condition必須条件は既存create_salary_offer()(0023)と完全に同一。pending重複防止はsalary_offers_store_one_pending_per_pair unique indexに委ねる（既存と対称の設計）。既存create_salary_offer()・respond_salary_offer()は無変更（respond_salary_offer()はstylist_user_id=auth.uid()とstatus=pendingのみで判定するため、v2で作成されたOfferにもそのまま使える）。通知は今回接続しない。';

revoke all on function public.create_salary_offer_v2(uuid, uuid, integer, integer, integer, text, text) from public, anon;
grant execute on function public.create_salary_offer_v2(uuid, uuid, integer, integer, integer, text, text) to authenticated;

commit;
