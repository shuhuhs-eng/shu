-- ============================================================================
-- Beauty Reach — 0023_notifications
-- アプリ内通知（第一段階）。メール/LINE/プッシュ配信は今回実装しない。
--
-- ★設計方針:
--   - 既存の給与オファー/実績確認/興味表明ロジックからは独立したテーブル・
--     RPCとして作る。既存RPCの本体（バリデーション・書き込み・戻り値・
--     エラー処理）は一切変更しない。末尾でcreate_notification()を追加で
--     1回呼ぶだけに留める。
--   - typeは自由文字列ではなくCHECK制約で許容値を列挙する。将来型を
--     増やす場合はCHECK制約を拡張するmigrationを追加すればよい。
--   - 重複防止: (user_id, type, related_entity_id)にunique制約を張り、
--     create_notification()はon conflict do nothingで安全に呼べるようにする。
--   - 書き込みはSECURITY DEFINER RPC経由のみ（既存テーブル群と同じ方針）。
--     クライアントにINSERT/UPDATE/DELETE権限は一切付与しない。
--
-- ★scout_received/scout_responded/interview_action_requiredについて:
--   調査の結果、「サロンが美容師をスカウトする」実際の機能
--   （テーブル・RPC・UI）はBeauty Reachにまだ存在しない
--   （user_settings.scout_enabledは「将来のスカウト機能向け」の設定フラグ
--   のみで、スカウトの送受信そのものは未実装）。そのため、この3つの
--   typeは将来の拡張用として許容値には含めるが、今回作成トリガーは
--   実装しない（存在しない機能を偽装して通知を作らない）。
-- ============================================================================

begin;

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in (
    'scout_received',
    'scout_responded',
    'salary_offer_received',
    'salary_offer_revised',
    'salary_offer_accepted',
    'salary_offer_revision_requested',
    'salary_offer_declined',
    'evidence_verified',
    'evidence_rejected',
    'interview_action_required',
    'stylist_interest_received'
  )),
  title text not null,
  message text not null,
  related_entity_type text,
  related_entity_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_event_unique unique (user_id, type, related_entity_id)
);
create index notifications_user_unread_idx on public.notifications (user_id, is_read, created_at desc);

alter table public.notifications enable row level security;
-- ★「自分の通知だけ読める」。書き込みはRPC経由のみのため、insert/update/
-- deleteのポリシーは作らない。
create policy notifications_select_own on public.notifications
  for select using (user_id = auth.uid());
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;

-- 通知作成ヘルパー(SECURITY DEFINER)。クライアントには実行権限を一切
-- 付与しない。他のSECURITY DEFINER RPC内部からのみ呼ばれる想定
-- （関数所有者権限で実行されるため、呼び出し元RPCに個別のgrantは不要）。
create or replace function public.create_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_related_entity_type text,
  p_related_entity_id uuid
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notifications (user_id, type, title, message, related_entity_type, related_entity_id)
  values (p_user_id, p_type, p_title, p_message, p_related_entity_type, p_related_entity_id)
  on conflict (user_id, type, related_entity_id) do nothing;
end;
$$;
revoke all on function public.create_notification(uuid,text,text,text,text,uuid) from public, anon, authenticated;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns public.notifications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_row public.notifications;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  update public.notifications
  set is_read = true, read_at = coalesce(read_at, now())
  where id = p_notification_id and user_id = v_uid
  returning * into v_row;
  if v_row.id is null then raise exception 'notification not found'; end if;
  return v_row;
end;
$$;
revoke all on function public.mark_notification_read(uuid) from public, anon;
grant execute on function public.mark_notification_read(uuid) to authenticated;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_count integer;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  update public.notifications
  set is_read = true, read_at = coalesce(read_at, now())
  where user_id = v_uid and is_read = false;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- ============================================================================
-- 既存RPCへの通知作成フックの追加。
-- ★重要: バリデーション・INSERT/UPDATE・戻り値は元のRPC定義から一切
-- 変更していない。末尾でperform create_notification(...)を1回追加した
-- だけで、それ以外の行は0022時点のものと同一。
-- ============================================================================

-- create_salary_offer: 成功時、求職者へ通知。同じ(salon,stylist)組の
-- 既存offerが既に存在する場合は「再提示」、初回なら「新規受信」として扱う
-- （判定はINSERT前に行う＝今回作られる行自身はカウントに含めない）。
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

-- respond_salary_offer: 成功時、サロンへ通知（承諾/条件相談/辞退それぞれ別type）。
create or replace function public.respond_salary_offer(
  p_offer_id uuid, p_response text, p_reason text default null, p_note text default null
) returns public.salary_offers
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.salary_offers;
  v_stylist_name text;
  v_notif_type text;
  v_title text;
  v_message text;
begin
  if p_response not in ('accepted','revision_requested','declined') then raise exception 'invalid response'; end if;
  if p_response='revision_requested' and (
    p_reason is null
    or p_reason not in ('workdays','guarantee_period','role','performance_basis','other')
  ) then
    raise exception 'reason required';
  end if;
  update public.salary_offers set status=p_response,
    response_reason=case when p_response='revision_requested' then p_reason end,
    response_note=case when p_response='revision_requested' then nullif(left(trim(coalesce(p_note,'')),500),'') end,
    responded_at=now()
  where id=p_offer_id and stylist_user_id=v_uid and status='pending'
  returning * into v_row;
  if v_row.id is null then raise exception 'offer not found'; end if;

  select public_name into v_stylist_name from public.stylist_profiles where user_id = v_uid;
  v_stylist_name := coalesce(v_stylist_name, '美容師');
  v_notif_type := case p_response
    when 'accepted' then 'salary_offer_accepted'
    when 'revision_requested' then 'salary_offer_revision_requested'
    else 'salary_offer_declined'
  end;
  v_title := case p_response
    when 'accepted' then v_stylist_name || 'が給与条件を承諾しました'
    when 'revision_requested' then v_stylist_name || 'から条件相談が届きました'
    else v_stylist_name || 'が給与条件を辞退しました'
  end;
  v_message := case p_response
    when 'accepted' then v_stylist_name || 'が提示した給与条件を承諾しました。'
    when 'revision_requested' then v_stylist_name || 'から条件について相談したいという連絡がありました。'
    else v_stylist_name || 'が今回の給与条件を辞退しました。'
  end;
  perform public.create_notification(v_row.salon_user_id, v_notif_type, v_title, v_message, 'salary_offer', v_row.id);

  return v_row;
end;
$$;
revoke all on function public.respond_salary_offer(uuid,text,text,text) from public, anon;
grant execute on function public.respond_salary_offer(uuid,text,text,text) to authenticated;

-- review_stylist_evidence_document: 成功時、美容師へ通知（確認済み/再提出）。
create or replace function public.review_stylist_evidence_document(
  p_document_id uuid,
  p_decision text,
  p_reason text,
  p_note text default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stylist_uid uuid;
  v_snapshot record;
begin
  if not public.is_platform_admin() then raise exception 'admin access required'; end if;
  if p_decision not in ('verified','rejected') then raise exception 'invalid decision'; end if;
  if p_decision = 'verified' and p_reason is distinct from 'valid' then
    raise exception 'verified requires valid reason';
  end if;
  if p_decision = 'rejected' and (
    p_reason is null
    or p_reason not in ('unrelated','unreadable','insufficient','numbers_mismatch','suspected_tampering')
  ) then
    raise exception 'invalid rejection reason';
  end if;

  update public.stylist_evidence_documents set
    review_status = p_decision,
    review_reason = p_reason,
    review_note = nullif(left(trim(coalesce(p_note, '')), 500), ''),
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = p_document_id
  returning stylist_user_id into v_stylist_uid;
  if v_stylist_uid is null then raise exception 'document not found'; end if;

  if p_decision = 'verified' then
    select avg_monthly_technical_sales, avg_monthly_clients, avg_monthly_named_clients, average_ticket
    into v_snapshot
    from public.stylist_match_profiles
    where stylist_user_id = v_stylist_uid;

    insert into public.stylist_match_verification_snapshots (
      stylist_user_id, evidence_document_id,
      avg_monthly_technical_sales, avg_monthly_clients, avg_monthly_named_clients, average_ticket,
      verified_by, verified_at
    ) values (
      v_stylist_uid, p_document_id,
      v_snapshot.avg_monthly_technical_sales, v_snapshot.avg_monthly_clients,
      v_snapshot.avg_monthly_named_clients, v_snapshot.average_ticket,
      auth.uid(), now()
    );
  end if;

  update public.stylist_match_profiles
  set average_ticket = average_ticket
  where stylist_user_id = v_stylist_uid;

  perform public.create_notification(
    v_stylist_uid,
    case when p_decision='verified' then 'evidence_verified' else 'evidence_rejected' end,
    case when p_decision='verified' then '提出資料が確認されました' else '資料の再提出が必要です' end,
    case when p_decision='verified' then '提出した実績資料が確認され、実績の状態が更新されました。'
         else '提出した実績資料について再提出が必要です。理由をご確認のうえ再提出してください。' end,
    'evidence_document', p_document_id
  );

  return true;
end;
$$;
-- 引数の型シグネチャ(uuid,text,text,text)は0022から変更していないため、
-- 既に付与済みのrevoke/grantがそのまま引き継がれる(再付与は不要)。

-- set_salon_interest: 「話を聞いてみたい」を新規送信した場合のみ、
-- サロンへ通知（取消時・既に送信済みの場合は通知しない）。
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
    insert into public.stylist_salon_interests (stylist_user_id, salon_user_id)
    values (v_stylist_uid, p_salon_user_id)
    on conflict (stylist_user_id, salon_user_id) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted then
      select public_name into v_stylist_name from public.stylist_profiles where user_id = v_stylist_uid;
      v_stylist_name := coalesce(v_stylist_name, '美容師');
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

comment on function public.set_salon_interest(uuid, boolean) is
  '美容師本人がPUBLICサロンへ「話を聞いてみたい」を送信・取消する唯一の経路。新規送信時のみサロンへ通知する。';

revoke all on function public.set_salon_interest(uuid, boolean) from public;
revoke all on function public.set_salon_interest(uuid, boolean) from anon;
grant execute on function public.set_salon_interest(uuid, boolean) to authenticated;

commit;
