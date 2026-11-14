-- 0063 の巻き戻し（草案）。会社所在地の入力内容と変更履歴が消えるため、実運用後は先にエクスポートすること。
begin;
drop function if exists public.admin_set_organization_location(uuid, text, text, text);
drop function if exists public.admin_get_organization_location(uuid);
drop table if exists public.organization_location_events;
alter table public.salon_organizations drop column if exists hq_prefecture, drop column if exists hq_city, drop column if exists hq_street_address,
  drop column if exists hq_location_updated_at, drop column if exists hq_location_updated_by;
drop function if exists public.is_known_prefecture(text);
commit;
