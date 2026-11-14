-- 0061 の【再開】（草案）。0061_suspend_keep_data.sql で止めたRPCの実行権限を戻す。データは変わらない。
begin;
grant execute on function public.admin_create_thread(uuid, text, uuid, uuid, uuid, uuid, text, text), public.admin_post_message(uuid, uuid, text, text),
  public.admin_set_thread_status(uuid, text), public.admin_list_threads(uuid, uuid, uuid, text, integer, integer), public.admin_get_thread(uuid),
  public.admin_record_delivery(uuid, text, text), public.inbox_list_threads(integer, integer), public.inbox_get_thread(uuid), public.inbox_reply(uuid, uuid, text)
  to authenticated;
commit;
