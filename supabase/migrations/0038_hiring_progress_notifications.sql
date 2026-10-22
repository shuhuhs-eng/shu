-- ============================================================================
-- Beauty Reach — 0038_hiring_progress_notifications
--
-- Phase 9。採用進捗(0037)の通知。アプリ内通知(notifications, 0023)のみ。
-- メール/LINE/プッシュは扱わない。
--
-- ★【状態: 案（未適用・未commit）】レビュー用。Supabaseへは適用しない。
--
-- ★既存notificationsを調べた結果（0023/0024）、既存schemaのままでは実装できない:
--   1. typeは CHECK 制約 notifications_type_check で11種に固定されており、
--      採用進捗の通知に使えるtypeが無い（interview_action_required は0023で
--      「将来用・未使用」として予約された1種のみで、面談設定/変更/内定/採用/
--      辞退を区別できない）。既存typeの意味を流用せず、typeを追加する。
--   2. unique(user_id, type, related_entity_id) があるため、related_entity_id に
--      「進捗(process)のid」を入れると、同一進捗での2回目以降の同種通知
--      （面談日時の再変更など）が on conflict do nothing で黙って捨てられる。
--      → related_entity_id には履歴イベント(store_hiring_process_events.id)を使う。
--      イベントは1操作につき1行で必ず別idになるため、この制約はそのまま
--      「同じ操作の二重通知防止」として働き、制約自体は変更しない。
--   3. 店舗側の通知から該当の進捗画面(/salon/stores/{storeId}/candidates/{processId})
--      へ飛ぶには storeId と processId が必要だが、notificationsには遷移先を
--      持つ列が無い（現在のベルはtypeごとの固定URL）。→ nullable の link_path を追加。
--
-- ★変更内容（既存の関数・テーブルの本体は変更しない。0001〜0037は無変更）:
--   A. notifications_type_check を、既存11種 + 採用進捗6種へ差し替え。
--        hiring_interview_scheduled   面談予定が登録された        （美容師へ）
--        hiring_interview_rescheduled 面談日時が変更された        （美容師へ）
--        hiring_status_updated        選考状況が更新された        （美容師へ）
--        hiring_offered               内定になった                （美容師へ）
--        hiring_hired                 採用になった                （美容師へ）
--        hiring_declined_by_stylist   美容師が選考を辞退した      （店舗の担当者へ）
--   B. notifications.link_path を追加（null可・先頭が'/'の相対パスのみ・300文字以内）。
--   C. 通知作成ヘルパー create_hiring_notification()（クライアントから実行不可）。
--   D. store_hiring_process_events への AFTER INSERT トリガー。
--      0037のRPC本体は変更せず、履歴イベントの追加に自然に連動して通知する
--      （通知の作り忘れ・RPCごとの二重実装が起きない）。
--
-- ★通知の対象（イベント → 通知）:
--     actor_kind = 'store' のイベント（店舗側の操作）
--       interview_scheduled   → 美容師へ hiring_interview_scheduled
--       interview_rescheduled → 美容師へ hiring_interview_rescheduled
--       interview_cancelled   → 美容師へ hiring_status_updated（面談の取り消し）
--       rejected              → 美容師へ hiring_status_updated（選考結果の更新・
--                               「今回はお見送り」。理由は一切含めない）
--       status_changed        → to_status = offered なら hiring_offered、
--                               それ以外は hiring_status_updated
--       hired                 → 美容師へ hiring_hired
--     actor_kind = 'stylist' のイベント
--       declined              → 店舗の書き込み権限者へ hiring_declined_by_stylist
--     通知しない: candidate_added（追加しただけでは知らせない）/ declined
--       （店舗側の辞退記録）/ reopened / internal_note_updated。
--
-- ★情報の分離（最重要）:
--   通知の本文には、店舗名・美容師の公開名・日時・状況名だけを使う。
--   internal_note / reason_code / reason_note / 店舗側の内部判断の内容 /
--   美容師が書いた辞退メッセージ / スタッフのuser idは、通知の
--   title/message/link_pathのどこにも入れない（不採用通知も定型文のみ）。
--   美容師宛のlink_pathは /stylist/applications 固定。
--
-- ★店舗側の宛先:
--   0037の can_manage_store_hiring と同じ規則（A: company_owner/company_admin/
--   recruiting_admin、B: area_manager かつ対象店舗の store_members 割当あり、
--   C: store_manager/recruiter）に当てはまる salon role のユーザー。viewerには
--   送らない（対応できないため）。※規則を変える場合は両方を揃えること。
--
-- ★堅牢性:
--   ・通知は付随機能。通知の作成に失敗しても採用進捗の更新・履歴の記録を
--     失敗させない（トリガー内で例外を捕まえて warning にする）。
--   ・美容師のアカウントが削除済み（0037は履歴識別子としてFK無しで保持）の場合は
--     notifications.user_id のFKに違反するため、存在確認してから作成する。
--   ・notifications への書き込みはSECURITY DEFINERのみ（0023の方針のまま）。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- A. type の追加（既存11種は一切変更しない）
-- ----------------------------------------------------------------------------
-- 既存のtype CHECK制約を名前に依存せず特定して削除する（0023のインライン制約は
-- 通常 notifications_type_check だが、適用先で名前が異なっても確実に差し替える）。
do $$
declare v_name text;
begin
  for v_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.notifications'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%scout_received%'
  loop
    execute format('alter table public.notifications drop constraint %I', v_name);
  end loop;
end $$;
alter table public.notifications add constraint notifications_type_check check (type in (
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
  'stylist_interest_received',
  'hiring_interview_scheduled',
  'hiring_interview_rescheduled',
  'hiring_status_updated',
  'hiring_offered',
  'hiring_hired',
  'hiring_declined_by_stylist'
));

-- ----------------------------------------------------------------------------
-- B. 遷移先 link_path（null可）。相対パスのみ（外部URL・'//'始まりは不可）。
-- ----------------------------------------------------------------------------
alter table public.notifications
  add column link_path text
  check (link_path is null or (link_path ~ '^/[A-Za-z0-9]' and char_length(link_path) <= 300));

comment on column public.notifications.link_path is
  '通知の遷移先（アプリ内の相対パス）。nullなら従来どおりtypeごとの固定遷移先。DB側のSECURITY DEFINER関数だけが設定する。';

-- ----------------------------------------------------------------------------
-- C. 採用進捗用の通知作成ヘルパー（内部専用）
--    related_entity_id = 履歴イベントid（unique(user_id,type,related_entity_id)で
--    同一イベントの二重通知を防ぐ）。
-- ----------------------------------------------------------------------------
create or replace function public.create_hiring_notification(
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_event_id uuid,
  p_link_path text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 履歴識別子はFK無しのため、削除済みアカウント宛ては作らない。
  if not exists (select 1 from auth.users where id = p_user_id) then
    return;
  end if;
  insert into public.notifications (
    user_id, type, title, message, related_entity_type, related_entity_id, link_path
  ) values (
    p_user_id, p_type, p_title, p_message, 'hiring_event', p_event_id, p_link_path
  )
  on conflict (user_id, type, related_entity_id) do nothing;
end;
$$;
revoke all on function public.create_hiring_notification(uuid, text, text, text, uuid, text)
  from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- D. 履歴イベント追加時のトリガー
-- ----------------------------------------------------------------------------
create or replace function public.notify_on_hiring_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.store_hiring_processes;
  v_store_name text;
  v_stylist_name text;
  v_type text;
  v_title text;
  v_message text;
  v_when text;
  v_status_label text;
  v_recipient uuid;
begin
  -- 通知の対象外イベントは何もしない。
  if not (
    (new.actor_kind = 'store' and new.event_type in
      ('interview_scheduled', 'interview_rescheduled', 'interview_cancelled', 'status_changed', 'hired', 'rejected'))
    or (new.actor_kind = 'stylist' and new.event_type = 'declined')
  ) then
    return new;
  end if;

  -- 通知は付随機能。失敗しても進捗の更新・履歴の記録は失敗させない。
  begin
    select * into v_p from public.store_hiring_processes where id = new.hiring_process_id;
    if v_p.id is null then return new; end if;
    select store_name into v_store_name from public.salon_stores where id = v_p.store_id;
    v_store_name := coalesce(v_store_name, '店舗');

    if new.actor_kind = 'store' then
      -- ---- 美容師へ ----
      v_when := case when new.interview_at is not null
        then to_char(new.interview_at at time zone 'Asia/Tokyo', 'YYYY/MM/DD HH24:MI') end;
      v_status_label := case new.to_status
        when 'contacting' then '連絡調整中'
        when 'interview_scheduled' then '面談予定'
        when 'interview_completed' then '面談済み'
        when 'selection' then '選考中'
        when 'offered' then '内定'
        when 'hired' then '採用'
        else null end;

      if new.event_type = 'interview_scheduled' then
        v_type := 'hiring_interview_scheduled';
        v_title := v_store_name || 'との面談が設定されました';
        v_message := coalesce('面談日時: ' || v_when || '（日本時間）。', '') || '詳細は選考状況からご確認ください。';
      elsif new.event_type = 'interview_rescheduled' then
        v_type := 'hiring_interview_rescheduled';
        v_title := v_store_name || 'との面談日時が変更されました';
        v_message := coalesce('新しい面談日時: ' || v_when || '（日本時間）。', '') || '詳細は選考状況からご確認ください。';
      elsif new.event_type = 'interview_cancelled' then
        v_type := 'hiring_status_updated';
        v_title := v_store_name || 'との面談が取り消されました';
        v_message := '面談の日程が白紙に戻りました。店舗からの連絡をお待ちください。';
      elsif new.event_type = 'rejected' then
        -- 内部理由・判断内容は一切含めない定型文。
        v_type := 'hiring_status_updated';
        v_title := '選考結果が更新されました';
        v_message := v_store_name || 'の選考結果が更新されました。今回はお見送りとなりました。';
      elsif new.event_type = 'hired' then
        v_type := 'hiring_hired';
        v_title := v_store_name || 'での採用が決定しました';
        v_message := '詳細は選考状況からご確認ください。';
      elsif new.to_status = 'offered' then
        v_type := 'hiring_offered';
        v_title := v_store_name || 'から内定が出ました';
        v_message := '詳細は選考状況からご確認ください。';
      else
        v_type := 'hiring_status_updated';
        v_title := v_store_name || 'の選考状況が更新されました';
        v_message := coalesce('現在の状況: ' || v_status_label || '。', '') || '詳細は選考状況からご確認ください。';
      end if;

      perform public.create_hiring_notification(
        v_p.stylist_user_id, v_type, v_title, v_message, new.id, '/stylist/applications'
      );

    else
      -- ---- 店舗の書き込み権限者へ（美容師が辞退）----
      select coalesce(public_name, '美容師') || 'さん' into v_stylist_name
        from public.stylist_profiles where user_id = v_p.stylist_user_id;
      v_stylist_name := coalesce(v_stylist_name, '美容師さん');

      for v_recipient in
        select distinct r.user_id
        from (
          -- A. 会社の管理者系3role
          select om.user_id
          from public.organization_members om
          join public.salon_stores s on s.organization_id = om.organization_id
          where s.id = v_p.store_id
            and om.role in ('company_owner', 'company_admin', 'recruiting_admin')
          union
          -- B. area_manager: 対象店舗の割当あり
          select om.user_id
          from public.organization_members om
          join public.salon_stores s on s.organization_id = om.organization_id
          join public.store_members sm on sm.store_id = s.id and sm.user_id = om.user_id
          where s.id = v_p.store_id and om.role = 'area_manager'
          union
          -- C. 店長・採用担当（viewerは含めない）
          select sm.user_id
          from public.store_members sm
          where sm.store_id = v_p.store_id and sm.role in ('store_manager', 'recruiter')
        ) r
        where exists (select 1 from public.user_roles ur where ur.user_id = r.user_id and ur.role = 'salon')
      loop
        perform public.create_hiring_notification(
          v_recipient,
          'hiring_declined_by_stylist',
          v_stylist_name || 'が選考を辞退しました',
          v_store_name || 'の選考について、辞退の連絡がありました。',
          new.id,
          '/salon/stores/' || v_p.store_id::text || '/candidates/' || v_p.id::text
        );
      end loop;
    end if;
  exception when others then
    raise warning 'notify_on_hiring_event failed (event %): % [%]', new.id, sqlerrm, sqlstate;
  end;

  return new;
end;
$$;
revoke all on function public.notify_on_hiring_event() from public, anon, authenticated;

create trigger trg_store_hiring_process_events_notify
  after insert on public.store_hiring_process_events
  for each row execute function public.notify_on_hiring_event();

commit;
