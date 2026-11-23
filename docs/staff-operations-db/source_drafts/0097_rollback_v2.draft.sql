-- 0097v2 巻き戻し草案（未適用）。スタッフ・履歴・招待が0件のときだけ実行できる（データを失わない）。
begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('beauty-reach-0097v2'));
lock table public.admin_staff, public.admin_staff_events, public.admin_staff_invitations in share row exclusive mode;
do $g$ begin
  if (select count(*) from public.admin_staff) + (select count(*) from public.admin_staff_events) + (select count(*) from public.admin_staff_invitations) > 0 then
    raise exception '0097v2 巻き戻し中止: スタッフ・履歴・招待のデータがあります。失えません。停止運用に切り替えてから判断してください';
  end if;
end $g$;
drop function public.admin_staff_password_reset_begin(uuid), public.admin_staff_invite_resend(uuid), public.admin_my_operator_state(), public.admin_operator_directory(), public.admin_staff_list(), public.admin_staff_set_status(uuid, text, text), public.admin_staff_rename(uuid, text), public.admin_staff_accept(),
  public.admin_staff_invitations_open(), public.admin_staff_invite_compensation_done(uuid, boolean, text), public.admin_staff_invite_compensation_begin(uuid), public.admin_staff_invite_register(uuid),
  public.admin_staff_invite_mark_auth_created(uuid, uuid), public.admin_staff_invite_begin(uuid, text, text), public.admin_operator_role(), public.is_admin_operator(), public.is_admin_staff_active(),
  public._staff_auth_user_unused(uuid, uuid), public._staff_session_ok(timestamptz);
drop table public.admin_staff_invitations;
drop table public.admin_staff_events;
drop function public.admin_staff_events_immutable();
drop table public.admin_staff;
commit;
