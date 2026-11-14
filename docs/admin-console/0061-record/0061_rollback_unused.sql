-- 0061 の巻き戻し【未使用時の完全削除】（草案）。
-- 実データが1行でもあれば、何も削除せずに拒否する（通常手順で DROP TABLE しない）。
-- データがある場合は 0061_suspend_keep_data.sql（停止）と 0061_RECOVERY.md（書き出し・復旧）を使う。
begin;
do $$
declare t text; n bigint; total bigint := 0;
begin
  foreach t in array array['admin_audit_events','admin_visit_cases','admin_threads','admin_messages','admin_message_deliveries','account_invitations','account_invitation_events','salon_inquiries'] loop
    execute format('select count(*) from public.%I', t) into n;
    total := total + n;
    if n > 0 then raise notice '%: % rows', t, n; end if;
  end loop;
  if total > 0 then
    raise exception '0061 のテーブルに実データがあります（% 行）。完全削除はできません。0061_suspend_keep_data.sql で停止し、0061_RECOVERY.md の手順で書き出してください。', total;
  end if;
end $$;
drop function if exists public.inbox_reply(uuid, uuid, text), public.inbox_get_thread(uuid), public.inbox_list_threads(integer, integer),
  public.admin_record_delivery(uuid, text, text), public.admin_get_thread(uuid), public.admin_list_threads(uuid, uuid, uuid, text, integer, integer),
  public.admin_set_thread_status(uuid, text), public.admin_post_message(uuid, uuid, text, text), public.admin_create_thread(uuid, text, uuid, uuid, uuid, uuid, text, text);
drop table public.account_invitation_events, public.account_invitations, public.admin_message_deliveries, public.admin_messages,
  public.admin_threads, public.admin_visit_cases, public.admin_audit_events, public.salon_inquiries;
drop function if exists public._admin_threads_consistency(), public._admin_messages_rules(), public._admin_inbox_can_see(uuid, uuid),
  public._admin_thread_visible_to(uuid, uuid), public._admin_salon_access(uuid, uuid, uuid), public._admin_request_hash(text, text[]),
  public._admin_lock_sender(uuid), public._admin_lock_request(uuid, uuid);
commit;
