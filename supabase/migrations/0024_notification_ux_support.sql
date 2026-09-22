-- ============================================================================
-- Beauty Reach — 0024_notification_ux_support
-- 0023（Supabase本番へ適用済み）に対する追加差分のみ。
--
-- ★0023は変更していない。notificationsテーブルの再作成・既存データの
-- 削除・RLSポリシーの変更・unique制約の変更は一切行わない。
--
-- 含まれる差分:
--   1. mark_notifications_read_by_entities RPCの新規追加
--      （カード単位=サロン単位/美容師単位で、そのentityに紐づく未読通知
--      だけを既読化する。本人(auth.uid())の行以外には一切触れない）。
--   2. respond_salary_offer / set_salon_interest の通知文言を
--      「○○さんから〜」の形に統一（CREATE OR REPLACEで該当2関数のみ
--      差し替え。バリデーション・書き込み・戻り値・pending制御・
--      role guardは0023から一切変更していない）。
-- ============================================================================

begin;

-- カード単位の既読化（例: 求職者側の「GVカード」だけ既読にする）。
-- p_entitiesは [{"type":"salary_offer","id":"..."}, ...] 形式のJSONB配列。
-- 本人(auth.uid())の未読通知のうち、渡されたtype+idの組に一致するものだけを
-- 既読化する。他社・他の美容師の未読には一切触れない。
create or replace function public.mark_notifications_read_by_entities(p_entities jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid(); v_count integer;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  update public.notifications n
  set is_read = true, read_at = coalesce(read_at, now())
  where n.user_id = v_uid
    and n.is_read = false
    and exists (
      select 1 from jsonb_to_recordset(p_entities) as e(type text, id uuid)
      where e.type = n.related_entity_type and e.id = n.related_entity_id
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.mark_notifications_read_by_entities(jsonb) from public, anon;
grant execute on function public.mark_notifications_read_by_entities(jsonb) to authenticated;

-- respond_salary_offer: 0023からの唯一の変更点は、通知の宛先氏名に
-- 「さん」を付けること（v_stylist_name := coalesce(...) || 'さん'）。
-- それ以外（バリデーション・pending制御・戻り値・通知type分岐）は
-- 0023と完全に同一。
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
  v_stylist_name := coalesce(v_stylist_name, '美容師') || 'さん';
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
-- 引数の型シグネチャ(uuid,text,text,text)は0023から変更していないため、
-- 既に付与済みのrevoke/grantがそのまま引き継がれる(再付与は不要)。

-- set_salon_interest: 0023からの唯一の変更点は、通知の送信元氏名に
-- 「さん」を付けること。role guard・PUBLIC可視性チェック・取消(delete)分岐・
-- 新規insert時のみ通知する判定(get diagnostics v_inserted)は0023と同一。
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
-- 引数の型シグネチャ(uuid, boolean)は0023から変更していないため、
-- 既に付与済みのrevoke/grantがそのまま引き継がれる(再付与は不要)。

commit;
