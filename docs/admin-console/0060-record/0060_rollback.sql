-- 0060 の巻き戻し（草案）。表・列・権限を変えていないので、関数を削除するだけ。
begin;
drop function if exists public.admin_list_organizations(text, text[], boolean, text, text, integer, integer);
drop function if exists public.admin_get_organization(uuid);
drop function if exists public.admin_list_salon_registrants_without_company(integer, integer);
drop function if exists public.admin_list_stylists(text, text[], boolean, text[], text, text, integer, integer);
drop function if exists public.admin_get_stylist(uuid);
drop function if exists public._admin_is_stylist_account(uuid);
drop function if exists public._admin_known_prefectures();
commit;
