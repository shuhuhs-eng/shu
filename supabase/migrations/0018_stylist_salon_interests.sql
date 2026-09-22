-- ============================================================================
-- Beauty Reach — 0018_stylist_salon_interests
-- 美容師がサロンへ「話を聞いてみたい」と明示的に意思表示する。
-- お気に入り（0017、本人だけの非公開情報）とは完全に別の機能。
-- ============================================================================

create table public.stylist_salon_interests (
  stylist_user_id uuid not null references auth.users(id) on delete cascade,
  salon_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (stylist_user_id, salon_user_id),
  constraint stylist_salon_interests_different_users check (stylist_user_id <> salon_user_id)
);

comment on table public.stylist_salon_interests is
  '美容師が対象サロンへ明示的に送った「話を聞いてみたい」。お気に入りとは別。書き込みはset_salon_interest() RPCのみ。';

alter table public.stylist_salon_interests enable row level security;

create policy stylist_salon_interests_select_sent_own
  on public.stylist_salon_interests
  for select
  using (stylist_user_id = auth.uid());

grant select on public.stylist_salon_interests to authenticated;

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
  else
    delete from public.stylist_salon_interests
    where stylist_user_id = v_stylist_uid
      and salon_user_id = p_salon_user_id;
  end if;

  return p_interested;
end;
$$;

create or replace function public.get_received_salon_interests()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_salon_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_salon_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.user_roles
    where user_id = v_salon_uid and role = 'salon'
  ) then
    raise exception 'caller is not a salon';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'stylist_user_id', i.stylist_user_id,
    'created_at', i.created_at,
    'public_name', sp.public_name,
    'prefecture', sp.prefecture,
    'desired_work_location', sp.desired_work_location,
    'experience_years', sp.experience_years,
    'current_position', sp.current_position,
    'specialties', sp.specialties,
    'job_change_intent', sp.job_change_intent,
    'bio', sp.bio
  ) order by i.created_at desc), '[]'::jsonb)
  into v_result
  from public.stylist_salon_interests i
  join public.stylist_profiles sp on sp.user_id = i.stylist_user_id
  where i.salon_user_id = v_salon_uid;

  return v_result;
end;
$$;

comment on function public.set_salon_interest(uuid, boolean) is
  '美容師本人がPUBLICサロンへ「話を聞いてみたい」を送信・取消する唯一の経路。';
comment on function public.get_received_salon_interests() is
  'サロン本人へ届いた意思表示と美容師の公開用プロフィールの必要最小限だけを返す。本名・メール・年齢・性別・給与希望・SNSは返さない。';

revoke all on function public.set_salon_interest(uuid, boolean) from public;
revoke all on function public.set_salon_interest(uuid, boolean) from anon;
grant execute on function public.set_salon_interest(uuid, boolean) to authenticated;

revoke all on function public.get_received_salon_interests() from public;
revoke all on function public.get_received_salon_interests() from anon;
grant execute on function public.get_received_salon_interests() to authenticated;
