-- ============================================================================
-- 草案（本番未実行・承認待ち）採用料の登録区分ルールを「決定済み」として設定に記録する。
-- 決定（2026-11-27・ユーザー）: 採用料の区分は「運営が本人に確認した登録区分」（スタイリスト550,000円／アシスタント450,000円・税抜）。
--   入社先で担当する業務では決めない。確認済みの値の入力は運営が行い、プロフィールの現在の役職などは参考表示のみ（自動判定しない）。
-- このSQLがすること: billing_settings の hire_fee_role_source 1行を decided にするだけ。他の設定・表・関数は変更しない。
-- ★自動請求・カード必須化は変更しない。ただし注意: これが唯一の「自動請求を有効にできない理由」だった場合、決定後はDBが
--   auto_charge_enabled を true にすることを拒否しなくなる（true にする操作は別。この草案では行わず、false のまま確認して終了する）。
-- 前提: 0109 適用済み。Supabase SQL Editor で全文を1回実行する（全体が1トランザクション。確認が1つでも外れると例外で全体が戻る）。
-- 使い方: 下の <RESPONSIBLE_USER_ID> を、責任者（platform_admins）のユーザーIDに置き換える。SQL Editor は auth.uid() が空のため、
--   責任者としての実行を、このトランザクション内だけ request.jwt.claim.sub で示す（DB関数は責任者でなければ拒否する）。
-- 戻し方: 記録後に戻す場合は、末尾の「戻す」を単独で実行（status を undecided に戻す）。
-- ============================================================================
begin;
set local lock_timeout = '5s';
do $pre$
declare v_uid text := '<RESPONSIBLE_USER_ID>';
begin
  if v_uid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception '先頭の <RESPONSIBLE_USER_ID> を責任者のユーザーIDに置き換えてください'; end if;
  if not exists (select 1 from public.platform_admins where user_id = v_uid::uuid) then raise exception '指定のユーザーは責任者（platform_admins）ではありません'; end if;
  perform set_config('request.jwt.claim.sub', v_uid, true);
  if to_regclass('public.billing_settings') is null then raise exception '0109が未適用です'; end if;
  if (select status from public.billing_settings where key = 'hire_fee_role_source') is distinct from 'undecided' then raise exception 'hire_fee_role_source は未決定の状態ではありません（すでに記録済みか、想定と違います）。何も変更せず中止します'; end if;
  if (select value from public.billing_settings where key = 'auto_charge_enabled') is distinct from 'false' then raise exception 'auto_charge_enabled が false ではありません。中止します'; end if;
  if (select value from public.billing_settings where key = 'salon_card_required') is distinct from 'false' then raise exception 'salon_card_required が false ではありません。中止します'; end if;
  create temp table _bs_before on commit drop as select key, md5(coalesce(value,'∅') || '|' || status) as h from public.billing_settings where key <> 'hire_fee_role_source';
end $pre$;

select public.admin_billing_setting_set('hire_fee_role_source', 'operator_confirmed_registration_class', 'decided');

do $post$
begin
  if not exists (select 1 from public.billing_settings where key = 'hire_fee_role_source' and status = 'decided' and value = 'operator_confirmed_registration_class') then raise exception '記録を確認できません。全体を戻します'; end if;
  if (select value from public.billing_settings where key = 'auto_charge_enabled') is distinct from 'false' then raise exception 'auto_charge_enabled が変わっています。全体を戻します'; end if;
  if (select value from public.billing_settings where key = 'salon_card_required') is distinct from 'false' then raise exception 'salon_card_required が変わっています。全体を戻します'; end if;
  if exists (select 1 from public.billing_settings s full join _bs_before b using (key) where s.key <> 'hire_fee_role_source' and md5(coalesce(s.value,'∅') || '|' || s.status) is distinct from b.h) then raise exception '他の設定が変わっています。全体を戻します'; end if;
end $post$;
-- 結果（この2行で確認）
select key, value, status from public.billing_settings where key in ('hire_fee_role_source','auto_charge_enabled','salon_card_required') order by key;
commit;

-- 戻す（必要なときだけ。上の <RESPONSIBLE_USER_ID> と同じ置き換えをして単独で実行）:
-- begin; select set_config('request.jwt.claim.sub','<RESPONSIBLE_USER_ID>',true); select public.admin_billing_setting_set('hire_fee_role_source', null, 'undecided'); commit;
