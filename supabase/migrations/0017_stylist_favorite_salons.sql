-- ============================================================================
-- Beauty Reach — 0017_stylist_favorite_salons
-- 美容師が公開サロンを「気になるサロン」として保存する。
-- ============================================================================

create table public.stylist_favorite_salons (
  stylist_user_id uuid not null references auth.users(id) on delete cascade,
  salon_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (stylist_user_id, salon_user_id),
  constraint stylist_favorite_salons_different_users check (stylist_user_id <> salon_user_id)
);

comment on table public.stylist_favorite_salons is
  '美容師本人が保存した気になるサロン。書き込みはset_favorite_salon() RPCのみ。';

alter table public.stylist_favorite_salons enable row level security;

create policy stylist_favorite_salons_select_own
  on public.stylist_favorite_salons
  for select
  using (stylist_user_id = auth.uid());

grant select on public.stylist_favorite_salons to authenticated;

create or replace function public.set_favorite_salon(
  p_salon_user_id uuid,
  p_favorite boolean
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

  if p_favorite then
    insert into public.stylist_favorite_salons (stylist_user_id, salon_user_id)
    values (v_stylist_uid, p_salon_user_id)
    on conflict (stylist_user_id, salon_user_id) do nothing;
  else
    delete from public.stylist_favorite_salons
    where stylist_user_id = v_stylist_uid
      and salon_user_id = p_salon_user_id;
  end if;

  return p_favorite;
end;
$$;

comment on function public.set_favorite_salon(uuid, boolean) is
  '美容師本人の気になるサロンを保存・解除する唯一の書き込み経路。対象はPUBLICのsalon roleに限定。';

revoke all on function public.set_favorite_salon(uuid, boolean) from public;
revoke all on function public.set_favorite_salon(uuid, boolean) from anon;
grant execute on function public.set_favorite_salon(uuid, boolean) to authenticated;
