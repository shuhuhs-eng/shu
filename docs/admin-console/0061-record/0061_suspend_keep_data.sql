-- 0061 の【停止（データを残す）】（草案）。運用開始後に問題が出たときの第一手段。
-- 表・データ・トリガー・内部関数は一切変えない。アプリから呼べる公開RPCの実行権限だけを外す（連絡の閲覧・返信・運営操作が止まる）。
-- 復旧（再開）は 0061_resume.sql。完全削除は、データを書き出して保管した後に、人が判断して別途行う（0061_RECOVERY.md）。
begin;
revoke execute on function public.admin_create_thread(uuid, text, uuid, uuid, uuid, uuid, text, text), public.admin_post_message(uuid, uuid, text, text),
  public.admin_set_thread_status(uuid, text), public.admin_list_threads(uuid, uuid, uuid, text, integer, integer), public.admin_get_thread(uuid),
  public.admin_record_delivery(uuid, text, text), public.inbox_list_threads(integer, integer), public.inbox_get_thread(uuid), public.inbox_reply(uuid, uuid, text)
  from authenticated;
commit;
