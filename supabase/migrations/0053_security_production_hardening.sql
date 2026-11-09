-- ============================================================================
-- 0053: 本番公開前のSecurity / Production Hardening（Phase 54）
-- ============================================================================
-- 最終監査（High・重要Medium）への対応。既存関数・テーブルの「定義」は一切変更しない。
-- 変更はすべて「追加」と「権限の絞り込み（revoke）」のみ。データは変更・削除しない。
--
--   A. 共有レート制限（サーバーレスでも効くDBベース）
--        rate_limit_counters / check_rate_limit() / cleanup_rate_limit_counters()
--        → service_role 専用。クライアント（anon / authenticated）からは見えない・呼べない。
--        → キーはアプリ側でSHA-256済みの値だけを保存する（IP・メールの生値は保存しない）。
--   B. 旧RPCの停止（authenticated からの EXECUTE を剥奪。関数定義は残す）
--        send_scout(uuid,text,text) / create_salary_offer(...) / set_salon_interest(uuid,boolean)
--        すべて店舗(store)単位のv2（send_scout_v2 / create_salary_offer_v2 / set_store_interest）で
--        代替済み。呼び出し元（旧UI・旧Server Action）はこのPhaseでアプリ側から除去する。
--   D. diagnosis_results の直接INSERTを廃止
--        診断結果は「サーバーが回答から再計算した値」だけが真値。クライアント（本人のJWT）が
--        REST経由で任意のスコア・タイプを直接INSERTできないよう、INSERT権限とINSERTポリシーを除去する。
--        正式な保存経路は、サーバー側（回答→再計算→service role でINSERT。user_idは認証済みの本人）に統一。
--        既存の診断結果は変更しない。SELECTポリシー・SECURITY DEFINER RPC（読み取り・AI状態更新）は不変。
--   F. 最小権限（least privilege）
--        ・anon: 全テーブルの INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER を剥奪（SELECTは変更しない。
--          PUBLICサロン公開等、RLSで制御されたanon SELECTが設計上あるため）。
--        ・authenticated: 全テーブルの TRUNCATE/REFERENCES/TRIGGER を剥奪（RLSの対象外で、アプリは使わない）。
--        ・authenticated: INSERT/UPDATE/DELETE を、アプリが本人のJWTで直接書き込む
--          salon_links（INSERT/DELETE）以外のテーブルから剥奪（書き込みはSECURITY DEFINER RPC経由）。
--          salon_links のUPDATEは呼び出し元が無いため剥奪（ポリシーは残す）。
--        ・anon / authenticated: シーケンスの権限を剥奪（直接INSERTが無くなったため不要）。
--        ・トリガー関数の EXECUTE を anon / authenticated から剥奪（トリガー発火はEXECUTE権限を要さない）。
--
-- 0001〜0052 は変更しない。成功報酬・Stripe金額・月額課金・請求書PDF・採用確定・請求/監査履歴には触れない。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- A. 共有レート制限
-- ----------------------------------------------------------------------------
create table public.rate_limit_counters (
  key_hash     text        not null check (char_length(key_hash) between 16 and 128),
  window_start timestamptz not null,
  hit_count    integer     not null default 0 check (hit_count >= 0),
  primary key (key_hash, window_start)
);
comment on table public.rate_limit_counters is '共有レート制限のカウンター（固定ウィンドウ）。key_hashはアプリ側でSHA-256済み（IP・メールの生値は保存しない）。service_role専用。cleanup_rate_limit_counters()で古い行を削除する。';
create index rate_limit_counters_window_idx on public.rate_limit_counters (window_start);

alter table public.rate_limit_counters enable row level security;
revoke all on table public.rate_limit_counters from public, anon, authenticated;

create or replace function public.check_rate_limit(
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
) returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_start timestamptz;
  v_end timestamptz;
  v_count integer;
begin
  if p_key_hash is null or char_length(p_key_hash) not between 16 and 128 then
    raise exception 'invalid rate limit key';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100000 then
    raise exception 'invalid rate limit';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit window';
  end if;

  v_start := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  v_end := v_start + make_interval(secs => p_window_seconds);

  -- 1文で原子的にカウントする（同時リクエストでも取りこぼさない）。
  insert into public.rate_limit_counters as c (key_hash, window_start, hit_count)
  values (p_key_hash, v_start, 1)
  on conflict (key_hash, window_start)
  do update set hit_count = c.hit_count + 1
  returning c.hit_count into v_count;

  allowed := v_count <= p_limit;
  retry_after_seconds := case
    when allowed then 0
    else greatest(1, ceil(extract(epoch from (v_end - v_now)))::integer)
  end;
  return next;
end;
$$;
revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;

create or replace function public.cleanup_rate_limit_counters(p_older_than interval default interval '2 days')
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  if p_older_than is null or p_older_than < interval '1 hour' then
    raise exception 'p_older_than must be at least 1 hour';
  end if;
  delete from public.rate_limit_counters where window_start < now() - p_older_than;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.cleanup_rate_limit_counters(interval) from public, anon, authenticated;
grant execute on function public.cleanup_rate_limit_counters(interval) to service_role;

-- ----------------------------------------------------------------------------
-- B. 旧RPCの停止（EXECUTEの剥奪のみ。関数定義は削除・変更しない）
-- ----------------------------------------------------------------------------
revoke execute on function public.send_scout(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.create_salary_offer(uuid, integer, integer, integer, text, text) from public, anon, authenticated;
revoke execute on function public.set_salon_interest(uuid, boolean) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- D. diagnosis_results の直接INSERT廃止
-- ----------------------------------------------------------------------------
drop policy if exists diagnosis_results_insert_own on public.diagnosis_results;
revoke insert, update, delete on public.diagnosis_results from anon, authenticated;
comment on table public.diagnosis_results is '確定した診断結果（回答・スコア・タイプ・市場価値のみ）。回答とversionを保持し再計算可能。ai_status以外は更新不可＝イミュータブル。0053以降、INSERTはサーバー（service role。回答から再計算した値のみ）に限定し、クライアントからの直接INSERTは不可。';

-- ----------------------------------------------------------------------------
-- F. 最小権限
-- ----------------------------------------------------------------------------
-- anon: 書き込み系・メタ権限をすべて剥奪（SELECTは変更しない）。
revoke insert, update, delete, truncate, references, trigger on all tables in schema public from anon;

-- authenticated: RLS対象外で、アプリが使わない権限。
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- authenticated: 直接書き込みは salon_links のINSERT/DELETEのみ許可。それ以外は剥奪する。
do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname <> 'salon_links'
  loop
    execute format('revoke insert, update, delete on table public.%I from authenticated', r.relname);
  end loop;
end $$;
revoke update on table public.salon_links from authenticated;

-- シーケンス（直接INSERTが無くなったため、クライアントに権限は不要）。
revoke all on all sequences in schema public from anon, authenticated;

-- トリガー関数（トリガーの発火はEXECUTE権限を要さない）。
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

commit;
