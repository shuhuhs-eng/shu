-- ============================================================================
-- 0051: Scout 送信・返信の通知接続（Phase 52）
-- ============================================================================
-- 背景:
--   notifications には 'scout_received' / 'scout_responded' の type が 0023 から
--   用意され、0038 で link_path 列も追加されたが、Scout処理（send_scout /
--   send_scout_v2 / respond_scout）とは接続されていなかった（0025の「次フェーズ」）。
--   そのため、サロンがScoutを送っても美容師の通知ベルに出ず、美容師が返信しても
--   店舗側は気付けなかった（＝採用進捗に追加する導線に辿り着けない）。
--
-- 方針:
--   ・既存RPC（send_scout / send_scout_v2 / respond_scout）は再定義しない。
--     scouts テーブルの AFTER INSERT / AFTER UPDATE トリガーで通知する。
--     → 旧経路・新経路どちらで送信されても1箇所で通知でき、0044等の本体ロジックと
--       二重管理にならない。
--   ・通知は付随機能。通知の作成に失敗しても Scout の送信・返信は失敗させない
--     （0038 notify_on_hiring_event と同じ方針。例外は warning に落とす）。
--   ・notifications には store_id を追加しない。related_entity_type='scout'、
--     related_entity_id=scouts.id、遷移先は link_path。
--   ・冪等性: unique(user_id, type, related_entity_id) に対し on conflict do nothing。
--     返信は response_status='no_response' からの1回だけ（respond_scout の更新条件）
--     なので、トリガーも「no_response → 返信済み」の遷移でのみ発火する。
--   ・店舗側の受信者は 0038 と同じ「書き込み権限者」:
--       company_owner / company_admin / recruiting_admin（会社の全店舗）
--       area_manager（対象店舗に割当がある場合のみ）
--       store_manager / recruiter（対象店舗）
--     viewer は含めない。旧 salon_user_id・auth.uid() だけでは決めない。
--     store_id が無い旧Scout（0025の send_scout 経由）だけは、店舗権限が無いため
--     送信者本人（salon_user_id）へ通知する。
--   ・本文に Scout本文 / 返信本文 / 内部メモは含めない（定型文のみ）。
--   ・0001〜0050は変更しない。既存の type 制約（0038）は変更不要（両typeとも許容済み）。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- A. Scout通知の作成ヘルパー（内部専用。クライアントに実行権限なし）
-- ----------------------------------------------------------------------------
create or replace function public.create_scout_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_scout_id uuid,
  p_link_path text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_type not in ('scout_received', 'scout_responded') then
    raise exception 'invalid scout notification type';
  end if;
  -- 削除済みアカウント宛ては作らない。
  if not exists (select 1 from auth.users where id = p_user_id) then
    return;
  end if;
  insert into public.notifications (
    user_id, type, title, message, related_entity_type, related_entity_id, link_path
  ) values (
    p_user_id, p_type, p_title, p_message, 'scout', p_scout_id, p_link_path
  )
  on conflict (user_id, type, related_entity_id) do nothing;
end;
$$;
revoke all on function public.create_scout_notification(uuid, text, text, text, uuid, text)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- B. 店舗側の受信者（書き込み権限者）を返す内部関数
--    0038 notify_on_hiring_event の受信者条件と同一。
-- ----------------------------------------------------------------------------
create or replace function public.store_hiring_staff_recipients(p_store_id uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct r.user_id
  from (
    select om.user_id
    from public.organization_members om
    join public.salon_stores s on s.organization_id = om.organization_id
    where s.id = p_store_id
      and om.role in ('company_owner', 'company_admin', 'recruiting_admin')
    union
    select om.user_id
    from public.organization_members om
    join public.salon_stores s on s.organization_id = om.organization_id
    join public.store_members sm on sm.store_id = s.id and sm.user_id = om.user_id
    where s.id = p_store_id and om.role = 'area_manager'
    union
    select sm.user_id
    from public.store_members sm
    where sm.store_id = p_store_id and sm.role in ('store_manager', 'recruiter')
  ) r
  where exists (select 1 from public.user_roles ur where ur.user_id = r.user_id and ur.role = 'salon');
$$;
revoke all on function public.store_hiring_staff_recipients(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- C. Scout送信 → 美容師へ scout_received
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_scout_sent()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_store_name text;
begin
  begin
    select store_name into v_store_name from public.salon_stores where id = new.store_id;
    v_store_name := coalesce(v_store_name, 'サロン');
    perform public.create_scout_notification(
      new.stylist_user_id,
      'scout_received',
      v_store_name || 'からスカウトが届きました',
      'スカウトの内容を確認して、お返事をしてみましょう。',
      new.id,
      '/stylist/scouts#scout-' || new.id::text
    );
  exception when others then
    raise warning 'notify_on_scout_sent failed (scout %): % [%]', new.id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;
revoke all on function public.notify_on_scout_sent() from public, anon, authenticated;

create trigger trg_scouts_notify_sent
  after insert on public.scouts
  for each row execute function public.notify_on_scout_sent();

-- ----------------------------------------------------------------------------
-- D. 美容師の返信 → 店舗側の書き込み権限者へ scout_responded
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_scout_responded()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_stylist_name text;
  v_label text;
  v_message text;
  v_link text;
  v_recipient uuid;
begin
  begin
    select coalesce(public_name, '美容師') || 'さん' into v_stylist_name
      from public.stylist_profiles where user_id = new.stylist_user_id;
    v_stylist_name := coalesce(v_stylist_name, '美容師さん');

    v_label := case new.response_status
      when 'interested' then '「話を聞いてみたい」と返信しました'
      when 'question'   then '「条件をもう少し知りたい」と返信しました'
      when 'considering' then '「今は検討中」と返信しました'
      when 'declined'   then 'スカウトを見送りました'
      else null end;
    if v_label is null then return new; end if;

    v_message := case new.response_status
      when 'interested' then 'スカウト履歴から、採用進捗に追加して連絡調整を始められます。'
      when 'question'   then '返信内容を確認し、必要に応じて採用進捗に追加できます。'
      else '返信内容はスカウト履歴から確認できます。' end;

    if new.store_id is not null then
      v_link := '/salon/stores/' || new.store_id::text || '/scouts#scout-' || new.id::text;
      for v_recipient in select r.user_id from public.store_hiring_staff_recipients(new.store_id) r
      loop
        perform public.create_scout_notification(
          v_recipient, 'scout_responded', v_stylist_name || 'が' || v_label, v_message, new.id, v_link
        );
      end loop;
    else
      -- 店舗に紐付かない旧Scout: 店舗権限が無いので送信者本人へ。
      perform public.create_scout_notification(
        new.salon_user_id, 'scout_responded', v_stylist_name || 'が' || v_label, v_message, new.id, '/salon/mypage'
      );
    end if;
  exception when others then
    raise warning 'notify_on_scout_responded failed (scout %): % [%]', new.id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;
revoke all on function public.notify_on_scout_responded() from public, anon, authenticated;

create trigger trg_scouts_notify_responded
  after update of response_status on public.scouts
  for each row
  when (old.response_status = 'no_response' and new.response_status <> 'no_response')
  execute function public.notify_on_scout_responded();

commit;
