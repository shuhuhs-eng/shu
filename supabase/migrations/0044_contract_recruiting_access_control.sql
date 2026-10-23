-- ============================================================================
-- 0044_contract_recruiting_access_control.sql
--
-- 契約状態(organization_contract_settings.contract_status)による「新しい採用活動」の制御。
--
-- ★基本原則：制御するのは「新しい採用活動を始められるか」だけ。すでに始まっている採用活動の
--   履歴・更新・採用成立(hired)・成功報酬・請求・閲覧は止めない（suspended / cancelled でも
--   既存の採用進捗を hired にできる。契約の停止・解約で成功報酬の発生を回避できる設計にしない）。
--
--   契約未設定 ........ 許可（legacy compatibility：導入時に既存会社を突然止めない）
--   trial / active .... 許可
--   suspended / cancelled .... 新しい採用活動は禁止、既存の採用の更新・hired・閲覧・請求は許可
--
-- ★禁止するもの（suspended / cancelled のとき）
--   ・新規Scout送信（send_scout_v2 / 旧 send_scout）
--   ・新規給与オファー作成（create_salary_offer_v2 / 旧 create_salary_offer）
--   ・新規の興味表明 interested=true（set_store_interest / 旧 set_salon_interest）
--     ※既にtrueの対象への interested=true 再実行はno-op成功（false/未登録→trueのみ禁止）
--     ※取り下げ interested=false は常に許可（自分の意思表示を解除できなくしない）
--   ・新規候補者追加（add_hiring_candidate）
--   ・declined / rejected → contacting の再開（update_hiring_status）
--
-- ★許可し続けるもの：面談設定・日時変更・完了、selection、offered、hired、declined、rejected、
--   社内メモ更新、美容師側の辞退、履歴の閲覧、hired による成功報酬の作成、成功報酬の確認・請求・入金、
--   billing の閲覧。0043 の hiring_create_success_fee() は無変更で通常どおり発火し、契約に基準額が
--   あれば、その時点の契約状態(suspended/cancelled を含む)と基準額をsnapshotする（監査証跡）。
--   成功報酬の免除などは自動では行わない。
--
-- ★旧RPCからの迂回を許さない：同じ操作ができる authenticated 向けの旧RPC
--   （send_scout / create_salary_offer / set_salon_interest）にも同じ契約guardを入れる。
--   旧RPCは store_id を持たないため、会社は次の「provenance／所属」だけから解決する（推測しない）。
--     ・呼び出し者基準（send_scout / create_salary_offer）: 呼び出し者が legacy_salon_user_id として
--       紐づく会社、または organization_members / store_members として所属する会社の「いずれか」が
--       停止/解約なら拒否（保守的。所属先が複数ある担当者の旧経路が止まる場合があるが、新経路(v2)は
--       会社ごとに判定される）。
--     ・対象サロン基準（set_salon_interest）: 対象サロンの legacy_salon_user_id が紐づく会社。
--   新しい経路(v2)は store_id を正とし、salon_stores.organization_id から会社を解決する
--   （salon_user_id・onboarding・先頭店舗から会社を推測しない）。
--
-- ★Scout quota：organization_scout_quotas は無変更。停止/解約でのScout拒否は quota の初期化・
--   ロック・集計より前に行うので、拒否しても quota は消費もリセットも削除もされない。
--   再開(active等)すれば以前の残りがそのまま使える。枠数・料金・契約との連動ルールは新設しない。
--
-- ★エラーメッセージは 'recruiting is paused for this organization' のみ（契約金額・契約状態・
--   SQL詳細を出さない）。UIでは後続Phaseで日本語に変換する。
--
-- ★admin_update_organization_contract（0043）の状態変更仕様は変えない。suspended/cancelled に
--   なった時点からDB guardが効き、active 等へ戻れば再び新規採用活動ができる。
--
-- ★既存 0001〜0043 は編集しない。既存RPCは CREATE OR REPLACE で差し替える（本体は元の定義を
--   そのまま写し、契約guardの呼び出しだけを追加。引数の型シグネチャは不変のため権限も不変）。
--
-- ★UIだけのdisabledにしない：guardはすべてDB(RPC)側にある。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. 契約状態の判定ヘルパー（内部用。authenticated から直接は呼べない）
-- ----------------------------------------------------------------------------
-- 会社の新規採用活動が止められているか。契約が無い会社は止められていない(legacy)。
create or replace function public.organization_recruiting_blocked(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.organization_contract_settings c
    where c.organization_id = p_organization_id
      and c.contract_status in ('suspended', 'cancelled')
  );
$$;
revoke all on function public.organization_recruiting_blocked(uuid) from public, anon, authenticated;

create or replace function public.assert_organization_recruiting_allowed(p_organization_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_organization_id is null then raise exception 'organization required'; end if;
  if public.organization_recruiting_blocked(p_organization_id) then
    raise exception 'recruiting is paused for this organization';
  end if;
end;
$$;
revoke all on function public.assert_organization_recruiting_allowed(uuid) from public, anon, authenticated;

-- store → organization を salon_stores.organization_id だけから解決して判定する。
create or replace function public.assert_store_recruiting_allowed(p_store_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
begin
  select organization_id into v_org from public.salon_stores where id = p_store_id;
  if v_org is null then raise exception 'store not found or not accessible'; end if;
  perform public.assert_organization_recruiting_allowed(v_org);
end;
$$;
revoke all on function public.assert_store_recruiting_allowed(uuid) from public, anon, authenticated;

-- 旧RPC用（呼び出し者基準）：呼び出し者に紐づく会社のいずれかが停止/解約なら拒否。
create or replace function public.assert_user_recruiting_allowed(p_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_user_id is null then raise exception 'not authenticated'; end if;
  if exists (
    select 1 from public.organization_contract_settings c
    where c.contract_status in ('suspended', 'cancelled')
      and c.organization_id in (
        select o.id from public.salon_organizations o where o.legacy_salon_user_id = p_user_id
        union
        select s.organization_id from public.salon_stores s where s.legacy_salon_user_id = p_user_id
        union
        select om.organization_id from public.organization_members om where om.user_id = p_user_id
        union
        select s.organization_id from public.store_members sm
          join public.salon_stores s on s.id = sm.store_id where sm.user_id = p_user_id
      )
  ) then
    raise exception 'recruiting is paused for this organization';
  end if;
end;
$$;
revoke all on function public.assert_user_recruiting_allowed(uuid) from public, anon, authenticated;

-- 旧RPC用（対象サロン基準）：対象の旧サロンに紐づく会社が停止/解約なら拒否。
create or replace function public.assert_salon_target_recruiting_allowed(p_salon_user_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1 from public.organization_contract_settings c
    where c.contract_status in ('suspended', 'cancelled')
      and c.organization_id in (
        select o.id from public.salon_organizations o where o.legacy_salon_user_id = p_salon_user_id
        union
        select s.organization_id from public.salon_stores s where s.legacy_salon_user_id = p_salon_user_id
      )
  ) then
    raise exception 'recruiting is paused for this organization';
  end if;
end;
$$;
revoke all on function public.assert_salon_target_recruiting_allowed(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. get_store_recruiting_access(): UI用の安全なread。
--    店舗スタッフ(is_store_accessible)だけが呼べる。その店舗が新規採用活動を受け付けているかと
--    理由コードだけを返す。契約状態・金額・契約詳細は返さない。
--    これはDB制御に必須ではない（制御は各RPCのguardが行う）。UIが送信前に
--    「現在、この店舗では新しい採用活動を受け付けていません」と出すためのもの。
-- ----------------------------------------------------------------------------
create or replace function public.get_store_recruiting_access(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_org uuid;
  v_blocked boolean;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;
  if not public.is_store_accessible(p_store_id) then
    raise exception 'store not found or not accessible';
  end if;
  select organization_id into v_org from public.salon_stores where id = p_store_id;
  v_blocked := public.organization_recruiting_blocked(v_org);
  return jsonb_build_object(
    'new_recruiting_allowed', not v_blocked,
    'reason_code', case when v_blocked then 'recruiting_paused' else null end
  );
end;
$$;
revoke all on function public.get_store_recruiting_access(uuid) from public, anon;
grant execute on function public.get_store_recruiting_access(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. 既存RPCの差し替え（元の定義を写し、契約guardの呼び出しだけを追加）
-- ----------------------------------------------------------------------------
-- ----------------------------------------------------------------------------
-- 5-1. send_scout_v2()（0034）：契約guardを追加（quotaより前）
-- ----------------------------------------------------------------------------
create or replace function public.send_scout_v2(
  p_store_id uuid,
  p_stylist_user_id uuid,
  p_message text,
  p_template_type text default null
) returns public.scouts
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_organization_id uuid;
  v_message text := nullif(trim(coalesce(p_message, '')), '');
  v_limit integer;
  v_credits integer;
  v_used integer;
  v_match jsonb;
  v_score integer;
  v_row public.scouts;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;

  -- ★店舗アクセス権は必ずis_store_accessible()で判定する（0026のRLSが使う
  -- 関数そのもの。auth.uid() = store所有者、という誤った判定は行わない）。
  if not public.is_store_accessible(p_store_id) then
    raise exception 'store not found or not accessible';
  end if;

  -- is_store_accessible()がtrueを返した時点でp_store_idは実在するため、
  -- organization_idは必ず取得できる。
  select organization_id into v_organization_id
  from public.salon_stores where id = p_store_id;

  -- ★0044: 契約状態による新規採用活動の制御（storeのorganizationで判定）。
  -- quotaの初期化・ロック・集計より前に拒否するので、拒否時はquotaに一切触れない。
  perform public.assert_organization_recruiting_allowed(v_organization_id);

  -- ★以下、既存send_scout()と完全に同一の対象美容師条件・入力検証
  -- （店舗単位対応による変更はしない）。
  if not exists (select 1 from public.user_roles where user_id = p_stylist_user_id and role = 'stylist') then
    raise exception 'target is not a stylist';
  end if;
  if not exists (select 1 from public.stylist_profiles where user_id = p_stylist_user_id and visibility = 'PUBLIC') then
    raise exception 'target stylist is not public';
  end if;
  if exists (select 1 from public.user_settings where user_id = p_stylist_user_id and scout_enabled = false) then
    raise exception 'target stylist has scouting disabled';
  end if;

  if v_message is null then raise exception 'message required'; end if;
  if char_length(v_message) > 1000 then raise exception 'message too long'; end if;
  if p_template_type is not null and p_template_type not in ('casual','concrete') then
    raise exception 'invalid template type';
  end if;

  -- ★quotaの契約主体はorganization。既存send_scout()と同じ
  -- 「insert...on conflict do nothingで初期化→for updateでロック」パターン
  -- をorganization_scout_quotasに適用する。同一organization内の複数店舗・
  -- 複数担当者が同時に送信しても、このロックにより直列化される（既存
  -- send_scout()のTOCTOU対策と同一の設計、ロック対象がsalon_user_id単位
  -- からorganization_id単位に変わるだけ）。
  insert into public.organization_scout_quotas (organization_id) values (v_organization_id)
  on conflict (organization_id) do nothing;

  select monthly_free_limit, additional_credits into v_limit, v_credits
  from public.organization_scout_quotas where organization_id = v_organization_id
  for update;

  -- ★月次使用数（重要・意図的な制限事項）: この会社が保有する全店舗
  -- （salon_stores.organization_id = v_organization_id）のうち、
  -- scouts.store_idが設定されている（=send_scout_v2経由で送信された）
  -- Scoutのみを当月使用数として数える。
  --
  -- 旧send_scout()経由のScout（store_id is null）は、0034時点では
  -- この集計に一切含めない。理由:
  --   ・二重カウント防止: 旧Scoutは旧salon_scout_quotas側で既に
  --     カウント対象になっているため、新organization quota側でも
  --     数えると同じ送信が2つのquotaから二重に消費されることになる。
  --   ・誤帰属防止: store_id=nullのScoutを
  --     「salon_onboarding_assignments経由で推測したstore」に勝手に
  --     帰属させることは、ユーザー指示により明示的に禁止されている
  --     （mappingが曖昧な行を推測で寄せない）。
  --
  -- ★既知のリスク（Phase 4 UI切替時に必ず対応が必要）: 0034時点では
  -- send_scout_v2はまだUIから呼ばれないため実害は無いが、将来UIが
  -- send_scout_v2を呼び始めた後も旧/salon/stylists（旧send_scout()）が
  -- 並走する期間がある場合、同じ会社が新旧両方のquotaをそれぞれ別枠
  -- として使える状態になり、実質的に合計の送信可能数が増えてしまう
  -- （quotaの抜け道）。この抜け道は0034では解消しない。UI切替時の対応策
  -- として、以下いずれかを選択する必要がある:
  --   (a) UI切替と同時に旧send_scout()の呼び出しを完全に停止する
  --       （旧ルート自体を閉じる。最も安全）。
  --   (b) 旧ルートを一定期間並走させる場合、送信前チェックの時点で
  --       旧salon_scout_quotasの残枠も合わせて消費済みとみなす統合判定
  --       ロジックを別migrationで追加する。
  -- いずれも0034の範囲外であり、今回は実装しない。
  select count(*) into v_used
  from public.scouts s
  join public.salon_stores ss on ss.id = s.store_id
  where ss.organization_id = v_organization_id
    and s.sent_at >= date_trunc('month', now());

  if v_used >= (v_limit + v_credits) then
    raise exception 'monthly scout limit reached';
  end if;

  -- ★matching_scoreはstoreのcultureを基準に算出する（0031の
  -- calculate_match_axes_by_store()。既存calculate_match_axesは使わない）。
  -- available=falseの場合はNULLのまま保存する（既存send_scout()と同じ
  -- 挙動。0点へ変換しない）。
  v_match := public.calculate_match_axes_by_store(p_stylist_user_id, p_store_id);
  v_score := case when (v_match->>'available')::boolean then (v_match->>'overall_score')::numeric::integer else null end;

  -- ★scouts INSERT: salon_user_id（旧互換列）・created_by_user_id（実際の
  -- 操作者）・store_id（採用活動主体）の3つを混同しない。
  --   salon_user_id      = v_uid（旧互換のため、NULLにしない）
  --   created_by_user_id = v_uid（実際にこのRPCを呼んだ担当者）
  --   store_id           = p_store_id（採用活動の主体）
  -- message/template_type/matching_scoreは既存send_scout()と同じ列。
  -- read_status/response_status/sent_at/created_atはテーブルのdefault値
  -- に委ねる（既存send_scout()と同一の挙動）。再Scout禁止のunique制約は
  -- 追加していない（既存仕様どおり、何度でも新しい履行行を作れる）。
  insert into public.scouts (
    salon_user_id, stylist_user_id, message, template_type, matching_score,
    store_id, created_by_user_id
  ) values (
    v_uid, p_stylist_user_id, v_message, p_template_type, v_score,
    p_store_id, v_uid
  )
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function public.send_scout_v2(uuid, uuid, text, text) from public, anon;
grant execute on function public.send_scout_v2(uuid, uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5-2. send_scout()（0025・旧版）：契約guardを追加（quotaより前）
-- ----------------------------------------------------------------------------
create or replace function public.send_scout(
  p_stylist_user_id uuid,
  p_message text,
  p_template_type text default null
) returns public.scouts
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_salon_uid uuid := auth.uid();
  v_message text := nullif(trim(coalesce(p_message, '')), '');
  v_limit integer;
  v_credits integer;
  v_used integer;
  v_match jsonb;
  v_score integer;
  v_row public.scouts;
begin
  if v_salon_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_salon_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;
  -- ★0044: 旧版経由でも契約制限を迂回できないようにする（storeを持たない旧経路のため、
  -- 呼び出し者に紐づく会社のいずれかが停止/解約なら拒否）。quotaより前に拒否する。
  perform public.assert_user_recruiting_allowed(v_salon_uid);
  if not exists (select 1 from public.user_roles where user_id = p_stylist_user_id and role = 'stylist') then
    raise exception 'target is not a stylist';
  end if;
  if not exists (select 1 from public.stylist_profiles where user_id = p_stylist_user_id and visibility = 'PUBLIC') then
    raise exception 'target stylist is not public';
  end if;
  if exists (select 1 from public.user_settings where user_id = p_stylist_user_id and scout_enabled = false) then
    raise exception 'target stylist has scouting disabled';
  end if;

  if v_message is null then raise exception 'message required'; end if;
  if char_length(v_message) > 1000 then raise exception 'message too long'; end if;
  if p_template_type is not null and p_template_type not in ('casual','concrete') then
    raise exception 'invalid template type';
  end if;

  -- 月間枠: salon_scout_quotasに行が無いサロンのためにdefault行
  -- （monthly_free_limit=10, additional_credits=0、列のデフォルト値）を
  -- 用意してから、その行をfor updateでロックする。これにより同一サロンから
  -- 同時に送信されたsend_scoutは、後続の呼び出しがこのロック取得の時点で
  -- 直列化される（先行トランザクションのcommit/rollbackまで待たされる）。
  insert into public.salon_scout_quotas (salon_user_id) values (v_salon_uid)
  on conflict (salon_user_id) do nothing;

  select monthly_free_limit, additional_credits into v_limit, v_credits
  from public.salon_scout_quotas where salon_user_id = v_salon_uid
  for update;

  -- 使用数は専用カウンタ列を持たず、当月分のscouts.sent_atを都度集計する
  -- （再スカウトも1回の使用としてカウントされる）。ロック取得後に数える
  -- ため、直前に確定した同一サロンの送信も必ずこのcountへ反映される。
  select count(*) into v_used from public.scouts
  where salon_user_id = v_salon_uid and sent_at >= date_trunc('month', now());

  if v_used >= (v_limit + v_credits) then
    raise exception 'monthly scout limit reached';
  end if;

  v_match := public.calculate_match_axes(p_stylist_user_id, v_salon_uid);
  v_score := case when (v_match->>'available')::boolean then (v_match->>'overall_score')::numeric::integer else null end;

  insert into public.scouts (salon_user_id, stylist_user_id, message, template_type, matching_score)
  values (v_salon_uid, p_stylist_user_id, v_message, p_template_type, v_score)
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function public.send_scout(uuid, text, text) from public, anon;
grant execute on function public.send_scout(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5-3. create_salary_offer_v2()（0035）：契約guardを追加
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

  -- ★0044: 契約状態による新規採用活動の制御（store_id → organization で判定）。
  perform public.assert_store_recruiting_allowed(p_store_id);

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
revoke all on function public.create_salary_offer_v2(uuid, uuid, integer, integer, integer, text, text) from public, anon;
grant execute on function public.create_salary_offer_v2(uuid, uuid, integer, integer, integer, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5-4. create_salary_offer()（0023・旧版）：契約guardを追加
-- ----------------------------------------------------------------------------
create or replace function public.create_salary_offer(
  p_stylist_user_id uuid, p_monthly_guarantee integer, p_performance_addition integer,
  p_guarantee_months integer, p_performance_condition text, p_salon_message text
) returns public.salary_offers
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.salary_offers;
  v_condition text := nullif(trim(coalesce(p_performance_condition, '')), '');
  v_salon_name text;
  v_is_revision boolean;
begin
  if not exists (select 1 from public.user_roles where user_id=v_uid and role='salon') then raise exception 'caller is not a salon'; end if;
  -- ★0044: 旧版経由でも契約制限を迂回できないようにする。
  perform public.assert_user_recruiting_allowed(v_uid);
  if not exists (select 1 from public.stylist_salon_interests where salon_user_id=v_uid and stylist_user_id=p_stylist_user_id) then raise exception 'interest required'; end if;
  if not exists (select 1 from public.stylist_match_profiles where stylist_user_id=p_stylist_user_id and wants_performance_offer and verification_status='verified') then raise exception 'verified opt-in profile required'; end if;
  if coalesce(p_performance_addition, 0) > 0 and v_condition is null then
    raise exception 'performance condition required when performance addition is greater than zero';
  end if;

  v_is_revision := exists (select 1 from public.salary_offers where salon_user_id=v_uid and stylist_user_id=p_stylist_user_id);

  insert into public.salary_offers(salon_user_id,stylist_user_id,monthly_guarantee,performance_addition,performance_condition,guarantee_months,salon_message)
  values(v_uid,p_stylist_user_id,p_monthly_guarantee,coalesce(p_performance_addition,0),v_condition,p_guarantee_months,nullif(trim(coalesce(p_salon_message,'')),''))
  returning * into v_row;

  select salon_name into v_salon_name from public.salon_profiles where user_id = v_uid;
  v_salon_name := coalesce(v_salon_name, 'サロン');
  perform public.create_notification(
    p_stylist_user_id,
    case when v_is_revision then 'salary_offer_revised' else 'salary_offer_received' end,
    case when v_is_revision then v_salon_name || 'から給与条件が再提示されました' else v_salon_name || 'から給与条件が届きました' end,
    case when v_is_revision then v_salon_name || 'から新しい給与条件が再提示されました。内容をご確認ください。'
         else v_salon_name || 'から月額保証' || v_row.monthly_guarantee::text || '円の給与条件が届きました。' end,
    'salary_offer', v_row.id
  );

  return v_row;
end;
$$;
revoke all on function public.create_salary_offer(uuid,integer,integer,integer,text,text) from public, anon;
grant execute on function public.create_salary_offer(uuid,integer,integer,integer,text,text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5-5. set_store_interest()（0035）：新しい興味表明(true)にguard。取り下げ(false)は許可
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
    -- ★0044: 新しい「話を聞いてみたい」は停止/解約中は受け付けない。
    -- 取り下げ(false)は常に許可する（自分の意思表示を解除できなくしない）。
    -- 既に同じ対象へのinterestが存在する場合の再実行(true→true)は新しい採用活動ではないので
    -- guardせずno-op（下のinsertは on conflict do nothing で何も書き換えない）。
    if not exists (
      select 1 from public.stylist_salon_interests
      where stylist_user_id = v_stylist_uid and store_id = p_store_id
    ) then
      perform public.assert_store_recruiting_allowed(p_store_id);
    end if;
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
revoke all on function public.set_store_interest(uuid, boolean) from public, anon;
grant execute on function public.set_store_interest(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 5-6. set_salon_interest()（0024・旧版）：新しい興味表明(true)にguard。取り下げ(false)は許可
-- ----------------------------------------------------------------------------
create or replace function public.set_salon_interest(
  p_salon_user_id uuid,
  p_interested boolean
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stylist_uid uuid := auth.uid();
  v_stylist_name text;
  v_inserted boolean;
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
    select 1
    from public.user_roles ur
    join public.salon_profiles sp on sp.user_id = ur.user_id
    where ur.user_id = p_salon_user_id
      and ur.role = 'salon'
      and sp.visibility = 'PUBLIC'
  ) then
    raise exception 'target salon is not public';
  end if;

  if p_interested then
    -- ★0044: 旧版経由でも契約制限を迂回できないようにする。取り下げ(false)は常に許可。
    -- 既存のinterest(true→true)の再実行はno-op（guardせず、insertも通知も発生しない）。
    if not exists (
      select 1 from public.stylist_salon_interests
      where stylist_user_id = v_stylist_uid and salon_user_id = p_salon_user_id
    ) then
      perform public.assert_salon_target_recruiting_allowed(p_salon_user_id);
    end if;
    insert into public.stylist_salon_interests (stylist_user_id, salon_user_id)
    values (v_stylist_uid, p_salon_user_id)
    on conflict (stylist_user_id, salon_user_id) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted then
      select public_name into v_stylist_name from public.stylist_profiles where user_id = v_stylist_uid;
      v_stylist_name := coalesce(v_stylist_name, '美容師') || 'さん';
      perform public.create_notification(
        p_salon_user_id, 'stylist_interest_received',
        v_stylist_name || 'から意思表示が届きました',
        v_stylist_name || 'が「話を聞いてみたい」を送りました。',
        'stylist_interest', v_stylist_uid
      );
    end if;
  else
    delete from public.stylist_salon_interests
    where stylist_user_id = v_stylist_uid
      and salon_user_id = p_salon_user_id;
  end if;

  return p_interested;
end;
$$;
revoke all on function public.set_salon_interest(uuid, boolean) from public, anon;
grant execute on function public.set_salon_interest(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 5-7. add_hiring_candidate()（0037）：契約guardを追加
-- ----------------------------------------------------------------------------
create or replace function public.add_hiring_candidate(
  p_store_id uuid,
  p_stylist_user_id uuid,
  p_internal_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_note text := nullif(trim(coalesce(p_internal_note, '')), '');
  v_offer_id uuid;
  v_scout_id uuid;
  v_source text;
  v_row public.store_hiring_processes;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;
  if not public.can_manage_store_hiring(p_store_id) then
    raise exception 'store not found or not accessible';
  end if;
  -- ★0044: 新規候補者の追加は、停止/解約中は受け付けない。
  perform public.assert_store_recruiting_allowed(p_store_id);
  if not exists (select 1 from public.user_roles where user_id = p_stylist_user_id and role = 'stylist') then
    raise exception 'target is not a stylist';
  end if;

  -- 接点の確認と起点の決定（給与オファー > スカウト > Interest の順で採用）。
  select id into v_offer_id from public.salary_offers
  where store_id = p_store_id and stylist_user_id = p_stylist_user_id
    and status in ('accepted', 'revision_requested')
  order by created_at desc limit 1;

  select id into v_scout_id from public.scouts
  where store_id = p_store_id and stylist_user_id = p_stylist_user_id
    and response_status in ('interested', 'question')
  order by sent_at desc limit 1;

  -- sourceに対応するIDだけを保存する（他方は必ずnull）。
  if v_offer_id is not null then
    v_source := 'salary_offer';
    v_scout_id := null;
  elsif v_scout_id is not null then
    v_source := 'scout';
    v_offer_id := null;
  elsif exists (
    select 1 from public.stylist_salon_interests
    where store_id = p_store_id and stylist_user_id = p_stylist_user_id
  ) then
    v_source := 'interest';
  else
    raise exception 'no engagement with this stylist';
  end if;

  -- 重複はunique(store_id, stylist_user_id)に委ねる前に、分かりやすく拒否する。
  if exists (
    select 1 from public.store_hiring_processes
    where store_id = p_store_id and stylist_user_id = p_stylist_user_id
  ) then
    raise exception 'candidate already exists for this store';
  end if;

  insert into public.store_hiring_processes (
    store_id, stylist_user_id, status, source, source_scout_id, source_salary_offer_id,
    internal_note, created_by_user_id, updated_by_user_id
  ) values (
    p_store_id, p_stylist_user_id, 'contacting', v_source, v_scout_id, v_offer_id,
    v_note, v_uid, v_uid
  ) returning * into v_row;

  insert into public.store_hiring_process_events (
    hiring_process_id, event_type, from_status, to_status, actor_user_id, actor_kind, internal_note
  ) values (v_row.id, 'candidate_added', null, 'contacting', v_uid, 'store', v_note);

  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'source', v_row.source);
end;
$$;
revoke all on function public.add_hiring_candidate(uuid, uuid, text) from public, anon;
grant execute on function public.add_hiring_candidate(uuid, uuid, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 5-8. update_hiring_status()（0037）：declined/rejected → contacting の再開にguard
-- ----------------------------------------------------------------------------
create or replace function public.update_hiring_status(
  p_process_id uuid,
  p_to_status text,
  p_public_note text default null,
  p_internal_note text default null,
  p_reason_code text default null,
  p_reason_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.store_hiring_processes;
  v_public text := nullif(trim(coalesce(p_public_note, '')), '');
  v_internal text := nullif(trim(coalesce(p_internal_note, '')), '');
  v_reason_code text := nullif(trim(coalesce(p_reason_code, '')), '');
  v_reason_note text := nullif(trim(coalesce(p_reason_note, '')), '');
  v_event text;
  v_clear_interview boolean := false;
begin
  v_p := public.hiring_lock_process_for_store_staff(p_process_id);

  if p_to_status is null or p_to_status = 'interview_scheduled' then
    raise exception 'use schedule_hiring_interview for interview_scheduled';
  end if;
  if not public.hiring_transition_allowed(v_p.status, p_to_status) then
    raise exception 'invalid status transition';
  end if;
  -- ★0044: 辞退・不採用から連絡調整中へ戻す再開は「新しい採用活動の再開」とみなし、
  -- 停止/解約中は受け付けない。それ以外の更新（面談・選考・内定・採用・辞退・不採用）は
  -- 契約状態に関わらず許可する（進行中の採用の成功報酬発生を回避させないため）。
  if v_p.status in ('declined', 'rejected') and p_to_status = 'contacting' then
    perform public.assert_store_recruiting_allowed(v_p.store_id);
  end if;
  -- 理由は辞退・不採用のときだけ受け付ける。
  if (v_reason_code is not null or v_reason_note is not null)
     and p_to_status not in ('declined', 'rejected') then
    raise exception 'reason is only allowed for declined or rejected';
  end if;

  v_event := case
    when v_p.status in ('declined', 'rejected') and p_to_status = 'contacting' then 'reopened'
    when v_p.status = 'interview_scheduled' and p_to_status = 'contacting' then 'interview_cancelled'
    when p_to_status = 'hired' then 'hired'
    when p_to_status = 'declined' then 'declined'
    when p_to_status = 'rejected' then 'rejected'
    else 'status_changed'
  end;
  v_clear_interview := (v_event = 'interview_cancelled');

  update public.store_hiring_processes
  set status = p_to_status,
      interview_at = case when v_clear_interview then null else interview_at end,
      interview_type = case when v_clear_interview then null else interview_type end,
      interview_location = case when v_clear_interview then null else interview_location end,
      candidate_message = coalesce(v_public, candidate_message),
      declined_by = case when p_to_status = 'declined' then 'store' else null end,
      reason_code = case when p_to_status in ('declined', 'rejected') then v_reason_code else null end,
      reason_note = case when p_to_status in ('declined', 'rejected') then v_reason_note else null end,
      hired_at = case when p_to_status = 'hired' then now() else hired_at end,
      hired_by_user_id = case when p_to_status = 'hired' then v_uid else hired_by_user_id end,
      closed_at = case
        when p_to_status in ('hired', 'declined', 'rejected') then now()
        when v_event = 'reopened' then null
        else closed_at end,
      updated_by_user_id = v_uid
  where id = v_p.id;

  insert into public.store_hiring_process_events (
    hiring_process_id, event_type, from_status, to_status, actor_user_id, actor_kind,
    public_note, internal_note, reason_code
  ) values (v_p.id, v_event, v_p.status, p_to_status, v_uid, 'store',
            v_public, coalesce(v_internal, v_reason_note), v_reason_code);

  return jsonb_build_object('id', v_p.id, 'status', p_to_status);
end;
$$;
revoke all on function public.update_hiring_status(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.update_hiring_status(uuid, text, text, text, text, text) to authenticated;

commit;
