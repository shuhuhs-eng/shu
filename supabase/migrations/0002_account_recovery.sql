-- ============================================================================
-- Beauty Reach — 0002_account_recovery
--
-- 0001_init.sql が適用済みの既存環境に対して、account_recovery_requests
-- （「登録メールアドレスが分からない方」向け問い合わせフォームの送信先）だけを
-- 追加する差分マイグレーション。
--
-- 含む内容:
--   ・account_recovery_status enum の作成
--   ・account_recovery_account_type enum の作成（無ければ）
--   ・account_recovery_requests テーブルの作成（NOT NULL / CHECK制約込み）
--   ・updated_at 自動更新トリガー
--   ・RLS 有効化（ポリシーは意図的に一切付けない）
--   ・anon / authenticated / PUBLIC への権限 REVOKE
--     （service role 以外から直接 SELECT/INSERT/UPDATE/DELETE できないことの保証）
--
-- 外部キーについて:
--   このテーブルは auth.users / profiles のいずれも参照しない（外部キー無し）。
--   これは設計上の意図であり、抜け漏れではない。本フォームは「本人か分からない
--   問い合わせ」を受け付けるためのものであり、既存アカウントとの照合・関連付けを
--   一切行わないという方針（route.ts のコメント参照）と一致させている。
--
-- 冪等性:
--   このファイルは複数回実行しても安全（既存オブジェクトがあればスキップ、
--   または安全に上書きされるだけで、エラーにも二重作成にもならない）。
--   ・enum は pg_type を確認してから作成（Postgresは CREATE TYPE IF NOT EXISTS
--     を持たないため、DOブロックで代替する）。
--   ・テーブルは CREATE TABLE IF NOT EXISTS。
--   ・トリガーは DROP TRIGGER IF EXISTS してから CREATE TRIGGER。
--   ・RLS有効化・REVOKE・COMMENT ONはPostgres標準として元々冪等。
--
-- 前提: 0001_init.sql が適用済みであること
--   （public.set_updated_at() 関数が既に存在している前提でトリガーを作成する）。
-- ============================================================================

-- ---------- 1. enum の作成（無ければ） ------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'account_recovery_account_type'
  ) then
    create type public.account_recovery_account_type as enum ('stylist', 'salon');
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'account_recovery_status'
  ) then
    create type public.account_recovery_status as enum ('PENDING', 'RESOLVED');
  end if;
end
$$;

-- ---------- 2. テーブルの作成 -----------------------------------------------
-- 「登録メールアドレスが分からない方」向け問い合わせフォーム(/account-recovery)の
-- 送信先。既存アカウント（auth.users・profiles等）との照合・自動応答は一切行わない
-- （このテーブルにも外部キーを持たせない＝設計上の意図）。
create table if not exists public.account_recovery_requests (
  id                  uuid primary key default gen_random_uuid(),
  display_name        text not null check (char_length(display_name) <= 60),
  account_type        public.account_recovery_account_type not null,
  salon_name          text not null check (char_length(salon_name) <= 60),
  prefecture           text not null check (char_length(prefecture) <= 20),
  instagram_handle     text check (instagram_handle is null or char_length(instagram_handle) <= 40),
  approximate_period   text not null check (char_length(approximate_period) <= 100),
  contact_email        text not null check (char_length(contact_email) <= 320),
  notes                text check (notes is null or char_length(notes) <= 2000),
  status               public.account_recovery_status not null default 'PENDING',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.account_recovery_requests is '「登録メールアドレスが分からない方」向け問い合わせの保存先。アカウントの存在確認・自動照合は一切行わない。RLSポリシー無し＝クライアントからは書き込み・読み出しとも不可。service role経由のINSERTのみ。本人確認・メールアドレス変更・データ移行は管理者が手動で対応する（statusを手掛かりに管理者がSupabase Studio等で対応する運用）。';
comment on column public.account_recovery_requests.contact_email is '現在連絡可能なメールアドレス（登録時のメールアドレスとは限らない）。本人確認のための連絡先であり、既存アカウントとの自動照合には使わない。';
comment on column public.account_recovery_requests.status is 'PENDING=未対応 / RESOLVED=対応済み。管理者がSupabase Studio等で手動更新する（アプリからは更新しない）。';

-- ---------- 3. updated_at 自動更新トリガー ----------------------------------
-- public.set_updated_at() は 0001_init.sql で定義済みの共通トリガー関数を再利用する。
drop trigger if exists trg_account_recovery_requests_updated on public.account_recovery_requests;
create trigger trg_account_recovery_requests_updated
  before update on public.account_recovery_requests
  for each row execute function public.set_updated_at();

-- ---------- 4. RLS 有効化（ポリシーは意図的に一切付けない） -----------------
alter table public.account_recovery_requests enable row level security;

-- ---------- 5. 権限の明示的REVOKE -------------------------------------------
-- 元々GRANTしていなくても、既存環境で意図せずGRANTが行われていた場合に備えて
-- 明示的にREVOKEする（RLSに加えてGRANT自体を無くすことで二重に保護する）。
revoke all on public.account_recovery_requests from anon;
revoke all on public.account_recovery_requests from authenticated;
revoke all on public.account_recovery_requests from public;

-- 上記の結果、SELECT/INSERT/UPDATE/DELETEはいずれも
--   ・RLSポリシーが一切無い（有効だが許可ポリシー0件＝全拒否）
--   ・anon/authenticated/PUBLICへのGRANTも無い
-- という二重の制約により、service role（RLS・GRANTの両方をバイパスする）
-- 以外からは直接アクセスできない。
