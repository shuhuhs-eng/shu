-- ============================================================================
-- Beauty Reach — 0008_user_roles_single_role
--
-- 「1 auth user = 1 role（stylist または salon のどちらか一方のみ）」を
-- DBレベルで強制する。
--
-- 背景: 0006_user_roles.sql は「1つのログインアカウントで美容師側と
-- サロン側の両方を利用できる」ことを目的に、user_id単位で複数行
-- （stylist行・salon行の両方）を許容する設計（primary key (user_id, role)）
-- として作られた。今回、美容師とサロンを完全に分離する方針に転換した
-- ため、user_id単位でroleを1つだけ持てるよう制約を追加する。
--
-- ★安全性についての重要な前提:
--   このmigrationは、既存の user_roles に複数roleを持つ user_id が
--   1件でも残っている場合、UNIQUE制約の追加自体が失敗し、適用されない
--   （PostgreSQLの仕様により、既存データが制約に違反していれば
--   ALTER TABLE ... ADD CONSTRAINT はエラーで中断する）。
--   このmigrationは既存データを自動的に削除・統合する処理を一切含まない。
--   適用前に、以下のSQLで複数roleユーザーが存在しないことを確認すること。
--
--     select user_id, count(*) from public.user_roles
--     group by user_id having count(*) > 1;
--
--   1件でも該当があれば、このmigrationは失敗する（＝安全側に倒れる）。
--   その場合は、どちらのroleを残すか人手で判断し、該当行を手動で削除
--   してから再度このmigrationを適用すること（本migrationはその削除処理
--   を含まない）。
-- ============================================================================

alter table public.user_roles
  add constraint user_roles_user_id_key unique (user_id);

comment on table public.user_roles is '1ユーザー(user_id)につきroleを1つだけ持てる（0008でuser_id単位のUNIQUE制約を追加）。行の存在＝「そのroleのオンボーディングを完了している」ことを表す。書き込みはsave_stylist_profile()/save_salon_profile() RPCがオンボーディング完了時に行う唯一の経路で、クライアントからの直接書き込みは許可しない。profiles.roleとは独立しており、profiles.roleはlegacy項目（signup時点の初期role）として残す。';
