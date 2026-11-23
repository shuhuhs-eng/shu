-- 0105 巻き戻し草案（v2・未適用）。記録・メモ・付記が全て0件のときだけ。
begin;
set local lock_timeout = '10s';
select pg_advisory_xact_lock(hashtext('beauty-reach-0105'));
lock table public.admin_work_records, public.admin_work_attributions, public.admin_work_notes in share row exclusive mode;
do $g$ begin if (select count(*) from public.admin_work_records) + (select count(*) from public.admin_work_attributions) + (select count(*) from public.admin_work_notes) > 0 then
  raise exception '0105 巻き戻し中止: 記録・付記・メモがあります。失えません'; end if; end $g$;
drop trigger admin_visit_request_events_to_work on public.admin_visit_request_events;
drop function public._admin_visit_event_to_work(), public._admin_visit_event_op(text, jsonb, jsonb), public._admin_record_work(text, text, uuid, text, timestamptz, jsonb),
  public.admin_work_attribution_add(uuid, uuid, text), public.admin_work_note_add(text, uuid, uuid, text), public.admin_work_records_for(text, uuid, integer), public.admin_work_notes_for(text, uuid, integer);
drop table public.admin_work_attributions, public.admin_work_notes, public.admin_work_records, public.admin_work_operation_catalog;
drop function public.admin_work_records_immutable();
commit;
