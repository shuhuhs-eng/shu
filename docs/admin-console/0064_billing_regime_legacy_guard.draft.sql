-- ============================================================================
-- 0064（レビュー用草案・未適用）: 旧料金→新料金の会社単位の切替と、旧成功報酬の「DBでの」抑止
-- ============================================================================
-- 方針（確定）:
--   ・会社ごとの明示的な切替。新方式の案件では旧成功報酬の【自動作成を抑止】する（運営の免除操作に依存しない）。
--   ・旧画面・旧APIからも、誤って旧請求を確定・決済できないようにする（アプリではなくDBのトリガーで拒否）。
--   ・既存の有効な請求・決済履歴は削除・再計算しない（追記専用の記録表と、新しいトリガーだけを足す）。
--   ・切替前から進行中の案件は「採用進行の作成時刻が切替日時より前なら旧」を既定とし、条件付きで運営が明示的に新へ変更できる。
--   ・月額無料へ移す会社に定期課金が残る場合は、切替そのものを拒否する（確認・停止・反映確認が済むまで切り替えられない）。
-- v4（0062との接続。★0062の適用後に適用する）:
--   ・「1採用」＝採用進行 store_hiring_processes.id（既存の 0037 が店舗×美容師ごとに1行とする現在の行）。見学案件が複数あっても、同じ採用進行の採用料は1つだけ。
--     （店舗×美容師の永久の一意制約は新設しない。判定は採用進行IDのみ。採用進行に紐づかない採用は個別確認）
--   ・新方式の採用料・旧成功報酬の存在確認／作成／方式変更は、すべて採用進行IDの共通ロック（pg_advisory_xact_lock）の下で行う。
--   ・切替は effective_from を過ぎるまで効かない（記録の存在だけでは切り替わらない）。判定は _billing_regime_active と _hiring_process_basis に一本化。
--   ・新方式の採用料（0062 admin_invoice_lines の hire_stylist / hire_assistant）と旧成功報酬の二重請求を、DBで相互に防ぐ。
--       (a) 採用料の行は、効力が生じた（effective_from以降の）新方式の会社・新方式の案件でだけ作れる。同じ採用進行に、取消でない旧成功報酬があれば作れない。
--       (b) 旧成功報酬の確定・請求済み・支払い済みへの遷移と、旧成功報酬のカード決済の開始は、同じ採用に有効な採用料の行があれば拒否。
--       (c) 旧成功報酬の自動作成は、同じ採用に有効な採用料の行があれば抑止し、「重複の疑い（fee_overlap）」を個別確認の一覧に残す。
-- 既存の関数・表の変更:
--   ・既存の関数 hiring_create_success_fee / begin_success_fee_card_checkout / admin_update_success_fee は【書き換えない】。
--     hiring_success_fees と stripe_checkout_records に BEFORE トリガーを足して、新方式の案件の旧成功報酬を止める。
--   ・get_admin_billing_integrity_issues（0040）だけを再定義する（新方式の hired に旧成功報酬が無いのを異常と数えないため）。
--     差分は1行（`public._hiring_process_basis(p.id) <> 'new'`）。巻き戻しファイルに元の定義を含む。
begin;

create table public.organization_billing_regime (
  organization_id uuid primary key references public.salon_organizations(id) on delete restrict,
  regime text not null default 'new' check (regime = 'new'),     -- 行が無い会社は旧方式。新方式への一方向のみ
  effective_from timestamptz not null,
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_at timestamptz not null default now()
);
create table public.hiring_process_billing_basis (                 -- 案件ごとの明示的な判定（既定は _hiring_process_basis が導く）
  hiring_process_id uuid primary key references public.store_hiring_processes(id) on delete restrict,
  basis text not null check (basis in ('legacy','new')),
  reason text not null check (char_length(reason) between 1 and 200),
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_at timestamptz not null default now()
);
alter table public.organization_billing_regime enable row level security;
alter table public.hiring_process_billing_basis enable row level security;
revoke all on public.organization_billing_regime, public.hiring_process_billing_basis from public, anon, authenticated, service_role;

create or replace function public._billing_append_only() returns trigger language plpgsql set search_path = public, pg_temp
as $$ begin raise exception 'billing regime records are append-only'; end $$;
create trigger trg_regime_append_only before update or delete on public.organization_billing_regime for each row execute function public._billing_append_only();
create trigger trg_basis_append_only before update or delete on public.hiring_process_billing_basis for each row execute function public._billing_append_only();

-- 共通ロック: 採用（採用進行ID）ごと。新方式の採用料と旧成功報酬の存在確認・作成・方式変更は、すべてこのロックの下で行う（トランザクション終了で解放）
create or replace function public._hiring_lock(p_process_id uuid) returns void
language sql security definer set search_path = public, pg_temp
as $$ select pg_advisory_xact_lock(hashtextextended('hire:' || p_process_id::text, 0)) $$;
-- 会社の新方式が「効力を持っているか」: 切替の記録があり、かつ effective_from 以前（未来日の切替は、その日時まで効かない）
create or replace function public._billing_regime_active(p_org uuid, p_at timestamptz default now()) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.organization_billing_regime r where r.organization_id = p_org and r.effective_from <= p_at) $$;

-- 判定: 明示行があればそれ。無ければ「会社の新方式が効力を持ち かつ 採用進行の作成時刻 >= 切替日時」なら新、それ以外は旧。（明示の新は、決定時に効力が生じている会社だけ）
create or replace function public._hiring_process_basis(p_process_id uuid) returns text
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(
    (select b.basis from public.hiring_process_billing_basis b where b.hiring_process_id = p_process_id),
    (select 'new' from public.store_hiring_processes pr
       join public.salon_stores s on s.id = pr.store_id
       join public.organization_billing_regime r on r.organization_id = s.organization_id
      where pr.id = p_process_id and pr.created_at >= r.effective_from),
    'legacy')
$$;
revoke all on function public._hiring_process_basis(uuid) from public, anon, authenticated;

-- (1) 新方式の案件では、旧成功報酬の自動作成を抑止（INSERTを静かにスキップ。採用成立の記録自体は通常どおり）
-- 「同じ採用」＝同じ採用進行の、取消でない有効な採用料の行
create or replace function public._hiring_has_active_hire_line(p_process_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (select 1 from public.admin_invoice_lines l
                  where l.hiring_process_id = p_process_id and l.voided_at is null and l.fee_kind in ('hire_stylist','hire_assistant'))
$$;

create or replace function public._trg_fee_insert_basis() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$ begin
  perform public._hiring_lock(new.hiring_process_id);   -- 新方式の採用料の作成・方式変更と直列化
  if public._hiring_process_basis(new.hiring_process_id) = 'new' then return null; end if;
  -- 新方式の採用料が同じ採用にすでにある場合は、旧成功報酬を作らない（二重請求の防止）。重複の疑いとして個別確認に残す
  if public._hiring_has_active_hire_line(new.hiring_process_id) then
    insert into public.admin_unresolved_billing_cases (organization_id, reason, note)
      values (new.organization_id, 'fee_overlap', '新方式の採用料がある採用で、旧成功報酬の自動作成を抑止しました（採用進行 ' || new.hiring_process_id || '）');
    return null;
  end if;
  return new;
end $$;
create trigger trg_hiring_success_fees_basis_insert before insert on public.hiring_success_fees for each row execute function public._trg_fee_insert_basis();

-- (2) 旧画面・旧APIからの確定・請求済み・支払い済みへの遷移を拒否（取消は可）
create or replace function public._trg_fee_update_basis() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$ begin
  if new.fee_status in ('confirmed','invoiced','paid') and new.fee_status is distinct from old.fee_status then
    perform public._hiring_lock(new.hiring_process_id);
    if public._hiring_process_basis(new.hiring_process_id) = 'new' then
      raise exception 'legacy success fee is not allowed for a new-regime case';
    end if;
    if public._hiring_has_active_hire_line(new.hiring_process_id) then
      raise exception 'a new-regime hire fee already exists for this hire';
    end if;
  end if;
  return new;
end $$;
create trigger trg_hiring_success_fees_basis_update before update on public.hiring_success_fees for each row execute function public._trg_fee_update_basis();

-- (3) 旧の成功報酬カード決済の開始を拒否。新方式の会社では月額（当面無料）の定期課金の開始も拒否する。
--     （カード登録 payment_method_setup とスカウト枠 scout_credits は対象外＝変更しない）
create or replace function public._trg_checkout_basis() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_proc uuid;
begin
  if new.purpose = 'monthly_subscription' then
    perform 1 from public.salon_organizations where id = new.organization_id for share;   -- 切替（組織行の排他ロック）と直列化
    -- 月額の決済開始は、新方式が「効力を持った」会社だけ拒否（未来日の切替は、その日時まで旧方式のまま）
    if public._billing_regime_active(new.organization_id) then raise exception 'monthly subscription is not billed under the new regime'; end if;
  end if;
  if new.purpose = 'success_fee' and new.success_fee_id is not null then
    select hiring_process_id into v_proc from public.hiring_success_fees where id = new.success_fee_id;
    if v_proc is not null then
      perform public._hiring_lock(v_proc);
      if public._hiring_process_basis(v_proc) = 'new' then raise exception 'legacy success fee is not allowed for a new-regime case'; end if;
      if public._hiring_has_active_hire_line(v_proc) then raise exception 'a new-regime hire fee already exists for this hire'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_stripe_checkout_basis before insert on public.stripe_checkout_records for each row execute function public._trg_checkout_basis();

-- (a) 新方式の採用料の行は、効力が生じた新方式の会社・案件でだけ作れ、同じ採用進行に旧成功報酬（取消・免除以外）があれば作れない（0062 admin_invoice_lines に足すトリガー）
-- 採用進行は案件(admin_visit_cases)から読む（トリガーは名前順で 0062 の規則より先に動く）。採用進行に紐づかない行の拒否は 0062 の規則が行う。
create or replace function public._trg_hire_line_regime_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_proc uuid;
begin
  if new.fee_kind not in ('hire_stylist','hire_assistant') then return new; end if;
  select c.hiring_process_id into v_proc from public.admin_visit_cases c where c.id = new.visit_case_id;
  if v_proc is null then return new; end if;
  perform public._hiring_lock(v_proc);   -- 旧成功報酬の作成・方式変更と直列化（ロック取得後に存在確認する）
  if not public._billing_regime_active(new.organization_id) then
    raise exception 'organization is not on the new billing regime';
  end if;
  if public._hiring_process_basis(v_proc) <> 'new' then
    raise exception 'hiring process is on the legacy billing basis';
  end if;
  if exists (select 1 from public.hiring_success_fees f where f.hiring_process_id = v_proc and f.fee_status not in ('cancelled','waived')) then
    raise exception 'a legacy success fee already exists for this hire';
  end if;
  return new;
end $$;
create trigger trg_admin_invoice_lines_regime_guard before insert on public.admin_invoice_lines for each row execute function public._trg_hire_line_regime_guard();

-- (4) 切替（運営者のみ）。過去の日時は不可（既存案件の判定が変わらないように）。定期課金・進行中の決済が残る会社は不可。
create or replace function public.admin_set_billing_regime(p_organization_id uuid, p_effective_from timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid(); v_eff timestamptz := coalesce(p_effective_from, now());
  v_sub record; v_in_progress int;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  perform 1 from public.salon_organizations where id = p_organization_id for update;
  if not found then raise exception 'organization not found'; end if;
  -- 再試行: すでに設定済みなら、設定済みの内容を返す（二重に設定しない。日時は最初の設定のまま）
  if exists (select 1 from public.organization_billing_regime where organization_id = p_organization_id) then
    return jsonb_build_object('already_set', true, 'effective_from', (select effective_from from public.organization_billing_regime where organization_id = p_organization_id));
  end if;
  if v_eff < now() - interval '1 minute' then raise exception 'effective_from must not be in the past'; end if;
  select * into v_sub from public.organization_subscriptions where organization_id = p_organization_id;
  if found and v_sub.subscription_status in ('active','trialing','past_due','unpaid','incomplete','paused') and not v_sub.cancel_at_period_end then
    raise exception 'legacy subscription is still active; stop it and confirm before switching';
  end if;
  if exists (select 1 from public.stripe_checkout_records where organization_id = p_organization_id and status in ('pending','open')) then
    raise exception 'an open checkout exists; wait for it to finish before switching';
  end if;
  insert into public.organization_billing_regime (organization_id, effective_from, decided_by) values (p_organization_id, v_eff, v_uid);
  select count(*) into v_in_progress from public.store_hiring_processes pr join public.salon_stores s on s.id = pr.store_id
    where s.organization_id = p_organization_id and pr.status not in ('hired','declined','rejected');
  return jsonb_build_object('effective_from', v_eff, 'in_progress_cases_kept_legacy', v_in_progress,
    'subscription_ends_at_period_end', coalesce(v_sub.cancel_at_period_end, false), 'subscription_period_end', v_sub.current_period_end);
end $$;

-- (5) 切替前から進行中の案件を、運営が明示的に新へ（または旧のままに）する。旧成功報酬が確定済み以降なら不可。
create or replace function public.admin_set_process_billing_basis(p_process_id uuid, p_basis text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_org uuid; v_fee public.hiring_success_fees; v_cancelled boolean := false; v_prev text;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_basis not in ('legacy','new') then raise exception 'invalid basis'; end if;
  if p_reason is null or char_length(trim(p_reason)) = 0 then raise exception 'reason required'; end if;
  select s.organization_id into v_org from public.store_hiring_processes pr join public.salon_stores s on s.id = pr.store_id where pr.id = p_process_id for update of pr;
  if v_org is null then raise exception 'process not found'; end if;
  -- ロック順: 採用進行の行 → 旧成功報酬の行 → 採用の共通ロック（旧成功報酬の更新トリガーと同じ順）
  select * into v_fee from public.hiring_success_fees where hiring_process_id = p_process_id for update;
  perform public._hiring_lock(p_process_id);
  select * into v_fee from public.hiring_success_fees where hiring_process_id = p_process_id for update;   -- ロック待ちの間に作られた旧成功報酬も拾うため、取得後に読み直す
  select basis into v_prev from public.hiring_process_billing_basis where hiring_process_id = p_process_id;
  if v_prev is not null then
    if v_prev = p_basis then return jsonb_build_object('basis', v_prev, 'already_decided', true); end if;   -- 再試行は何もしない
    raise exception 'basis already decided';
  end if;
  if p_basis = 'new' and not public._billing_regime_active(v_org) then raise exception 'organization is not on the new regime yet'; end if;   -- 未来日の切替は、効力が生じるまで案件を新にできない
  if p_basis = 'legacy' and public._hiring_has_active_hire_line(p_process_id) then raise exception 'a new-regime hire fee already exists for this hire'; end if;
  if p_basis = 'new' and v_fee.id is not null then
    if v_fee.fee_status not in ('pending_confirmation','cancelled') then raise exception 'success fee already progressed; cannot move to the new regime'; end if;
    if v_fee.fee_status = 'pending_confirmation' then
      -- 金額も請求も無い自動作成の行だけを「取消」にする（削除・再計算はしない。履歴を残す）
      update public.hiring_success_fees set fee_status = 'cancelled', cancelled_at = now() where id = v_fee.id;
      insert into public.hiring_success_fee_events (success_fee_id, event_type, from_status, to_status, actor_user_id, note)
        values (v_fee.id, 'cancelled', 'pending_confirmation', 'cancelled', v_uid, '新方式へ移すため取消（金額・請求なし）: ' || left(trim(p_reason), 200));
      v_cancelled := true;
    end if;
  end if;
  insert into public.hiring_process_billing_basis (hiring_process_id, basis, reason, decided_by) values (p_process_id, p_basis, left(trim(p_reason), 200), v_uid);
  return jsonb_build_object('basis', p_basis, 'legacy_fee_cancelled', v_cancelled);
end $$;

-- (6) 切替前の確認用（運営者のみ・読み取り）: 定期課金・進行中の決済・案件の内訳
create or replace function public.admin_billing_regime_status(p_organization_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  select jsonb_build_object(
    'regime', coalesce((select r.regime from public.organization_billing_regime r where r.organization_id = o.id), 'legacy'),
    'effective_from', (select r.effective_from from public.organization_billing_regime r where r.organization_id = o.id),
    'is_effective', public._billing_regime_active(o.id),
    'subscription', (select jsonb_build_object('status', s.subscription_status, 'cancel_at_period_end', s.cancel_at_period_end, 'current_period_end', s.current_period_end) from public.organization_subscriptions s where s.organization_id = o.id),
    'open_checkouts', (select count(*) from public.stripe_checkout_records c where c.organization_id = o.id and c.status in ('pending','open')),
    'legacy_fees_open', (select count(*) from public.hiring_success_fees f where f.organization_id = o.id and f.fee_status in ('pending_confirmation','confirmed','invoiced')),
    'processes_in_progress', (select count(*) from public.store_hiring_processes pr join public.salon_stores s on s.id = pr.store_id where s.organization_id = o.id and pr.status not in ('hired','declined','rejected')),
    'switch_blocked_reason', case
       when exists (select 1 from public.organization_billing_regime r where r.organization_id = o.id) then 'already_new'
       when exists (select 1 from public.organization_subscriptions s where s.organization_id = o.id and s.subscription_status in ('active','trialing','past_due','unpaid','incomplete','paused') and not s.cancel_at_period_end) then 'legacy_subscription_active'
       when exists (select 1 from public.stripe_checkout_records c where c.organization_id = o.id and c.status in ('pending','open')) then 'open_checkout'
       else null end
  ) into v from public.salon_organizations o where o.id = p_organization_id;
  if v is null then raise exception 'organization not found'; end if;
  return v;
end $$;

-- 権限の整理（既定の権限に依存しない）。新設の記録表は上で全ロールから外済み。
-- 内部関数・トリガー関数: どのロールにも実行権限を付けない
revoke all on function public._billing_append_only(), public._hiring_lock(uuid), public._billing_regime_active(uuid, timestamptz), public._hiring_process_basis(uuid),
  public._hiring_has_active_hire_line(uuid), public._trg_fee_insert_basis(), public._trg_fee_update_basis(), public._trg_checkout_basis(), public._trg_hire_line_regime_guard()
  from public, anon, authenticated, service_role;
-- 公開RPC（3本）: authenticated のみ
revoke all on function public.admin_set_billing_regime(uuid, timestamptz), public.admin_set_process_billing_basis(uuid, text, text), public.admin_billing_regime_status(uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_set_billing_regime(uuid, timestamptz), public.admin_set_process_billing_basis(uuid, text, text), public.admin_billing_regime_status(uuid) to authenticated;

-- (7) 0040 の整合性チェックの再定義（差分は1行）
create or replace function public.get_admin_billing_integrity_issues()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;

  with issues as (
    -- 1. hiredなのに成功報酬が無い
    select 'missing_success_fee'::text as issue_type, 'critical'::text as severity,
           p.id as hiring_process_id, null::uuid as success_fee_id,
           s.organization_id, p.store_id, p.stylist_user_id,
           p.hired_at,
           '採用が成立していますが、成功報酬の記録がありません。'::text as message
    from public.store_hiring_processes p
    join public.salon_stores s on s.id = p.store_id
    where p.status = 'hired'
      and not exists (select 1 from public.hiring_success_fees f where f.hiring_process_id = p.id)
      and public._hiring_process_basis(p.id) <> 'new'   -- 新方式の案件は、旧成功報酬を作らないのが正しい状態

    union all
    -- 2. 成功報酬があるのに採用進捗がhiredではない
    select 'process_not_hired', 'critical',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           '成功報酬の記録がありますが、対応する採用進捗が「採用」になっていません。'
    from public.hiring_success_fees f
    join public.store_hiring_processes p on p.id = f.hiring_process_id
    where p.status <> 'hired'

    union all
    -- 3. store_idの不一致
    select 'store_mismatch', 'critical',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           '成功報酬の店舗が、採用進捗の店舗と一致しません。'
    from public.hiring_success_fees f
    join public.store_hiring_processes p on p.id = f.hiring_process_id
    where f.store_id <> p.store_id

    union all
    -- 4. stylist_user_idの不一致
    select 'stylist_mismatch', 'critical',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           '成功報酬の美容師が、採用進捗の美容師と一致しません。'
    from public.hiring_success_fees f
    join public.store_hiring_processes p on p.id = f.hiring_process_id
    where f.stylist_user_id <> p.stylist_user_id

    union all
    -- 6. hired_atの不一致（採用進捗のhired_atが空の場合も不一致として扱う）
    select 'hired_at_mismatch', 'critical',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           '成功報酬の採用成立日が、採用進捗の採用成立日と一致しません。'
    from public.hiring_success_fees f
    join public.store_hiring_processes p on p.id = f.hiring_process_id
    where f.hired_at is distinct from p.hired_at

    union all
    -- 履歴との不整合（成功報酬の状態と最新eventのto_statusが違う／履歴が無い）
    select 'event_status_mismatch', 'warning',
           f.hiring_process_id, f.id, f.organization_id, f.store_id, f.stylist_user_id, f.hired_at,
           case when le.to_status is null
                then '成功報酬の履歴が記録されていません。'
                else '成功報酬の状態が、履歴の最新の状態と一致しません。' end
    from public.hiring_success_fees f
    left join lateral (
      select e.to_status
      from public.hiring_success_fee_events e
      where e.success_fee_id = f.id
      order by e.created_at desc, e.id desc
      limit 1
    ) le on true
    where le.to_status is distinct from f.fee_status
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'issue_type', i.issue_type,
    'severity', i.severity,
    'hiring_process_id', i.hiring_process_id,
    'success_fee_id', i.success_fee_id,
    'organization_id', i.organization_id,
    'store_id', i.store_id,
    'store_name', st.store_name,
    'stylist_name', sp.public_name,
    'hired_at', i.hired_at,
    'message', i.message
  ) order by (i.severity = 'critical') desc, i.hired_at desc nulls last, i.issue_type), '[]'::jsonb)
  into v_result
  from issues i
  left join public.salon_stores st on st.id = i.store_id
  left join public.stylist_profiles sp on sp.user_id = i.stylist_user_id;

  return v_result;
end;
$$;
revoke all on function public.get_admin_billing_integrity_issues() from public, anon;
grant execute on function public.get_admin_billing_integrity_issues() to authenticated;

commit;
