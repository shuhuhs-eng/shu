-- ============================================================================
-- 0055: 共有レート制限の「予約ID方式」の枠（新規登録のCAPTCHA未検証要求が他人のメール枠を消費しない）
-- ============================================================================
-- 背景: 新規登録のCAPTCHA検証はSupabase Auth（signUp内）が行うため、アプリがメール単位の枠を
--   数える時点では未検証。偽のトークンでも他人のメールの枠を消費できてしまう。
--   トークンは1回しか検証できず、アプリ側で先に検証すると二重検証になるため、
--   「検証中の予約（pending）→ 結果が分かったら確定（confirmed）または返却（released）」の2段階にする。
--
-- 設計（初版の「カウンターを+1/-1する」方式を廃止）:
--   * 1回の要求 = 1行（予約ID＝推測できないUUID）。枠の使用数は「行の状態から数える」。
--     加算・減算の演算をしないため、同じ返却を何度実行しても、他の要求の枠は変化しない（冪等）。
--   * 状態は pending → confirmed / released の一方向のみ。確定・返却は pending の行にだけ効く。
--       confirmed: CAPTCHAを通った要求（成功・既存メール・メール送信失敗なども含む）。枠を消費する。
--       released : CAPTCHA検証に失敗した要求。枠を消費しない。
--   * 枠の判定（★「5回/時」は厳密な上限ではない。下の「限界」参照）:
--       確定済み(confirmed) >= p_confirmed_limit  → 拒否（reason='limit'）。確認メールを送りすぎない主制限。
--       検証中(pending・期限内) >= p_inflight_limit → 拒否（reason='busy'）。同時の検証中が多すぎる。
--     検証中の予約は、期限（p_pending_ttl_seconds）を過ぎると数えない（回収）。
--     通信切断・プロセス終了・返却RPCの失敗で pending が残っても、期限で自動的に枠から外れる。
--   * 拒否された要求は行を作らない（返却が不要）。
--   * 同時要求は (key, window) 単位のアドバイザリロックで直列化する（判定と挿入が原子的）。
--   * 期限後に遅れて届いた確定は、その要求自身の行にだけ効く（実際に通った要求の記録として数える）。
--     期限後に遅れて届いた返却は、その行を released にするだけで他へ影響しない。
--
-- 限界（残る制約）:
--   * 同時の正常要求では、確定数が p_confirmed_limit を超え得る（検証中の上限が3なら最大で 上限-1+3 = 7。ローカルDBで7を確認）。
--     さらに、期限切れ後に届いた遅延確定、および確定通知の失敗（数えられない）があるため、7も絶対の上限ではない。
--   * 偽トークンなどの未検証要求も、応答待ちの間は検証中(pending)の枠を占める。同時に検証中の上限以上を保たれると、
--     その間は本人の要求が一時的に拒否される（busy）。
--   * 結果を通知できなかった予約は、期限（アプリは60秒）で枠から外れて回復する。その間は枠を占める。
--   * DB障害・本ファイル未適用時、アプリはインスタンス単位のメモリ制限へ縮退する（インスタンスをまたいで共有されない）。
--
-- 既存の rate_limit_counters / check_rate_limit() / cleanup_rate_limit_counters() は変更しない
--   （IP単位など既存のキーは従来どおり。新しい関数とは別のテーブル・別のキー空間）。
--
-- 権限: テーブルは RLS 有効・ポリシー無し・service_role を含む全ロールから REVOKE（SECURITY DEFINER関数のみが触る）。
--   関数は public / anon / authenticated から REVOKE し、service_role にだけ EXECUTE を付与する。
--   全体GRANT・RLS無効化・ALTER DEFAULT PRIVILEGES は使わない。0001〜0054 は変更しない。
-- ============================================================================

begin;

create table public.rate_limit_reservations (
  id           uuid        primary key default gen_random_uuid(),
  key_hash     text        not null check (char_length(key_hash) between 16 and 128),
  window_start timestamptz not null,
  state        text        not null default 'pending' check (state in ('pending', 'confirmed', 'released')),
  expires_at   timestamptz not null,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz
);
comment on table public.rate_limit_reservations is '共有レート制限の予約（1要求=1行）。使用数は行の状態から数える。key_hashはアプリ側でSHA-256済み。service_role専用（SECURITY DEFINER関数経由のみ）。';
create index rate_limit_reservations_key_idx on public.rate_limit_reservations (key_hash, window_start, state);
create index rate_limit_reservations_created_idx on public.rate_limit_reservations (created_at);

alter table public.rate_limit_reservations enable row level security;
-- service_role も明示的にREVOKEする（SECURITY DEFINER関数経由のみで使う設計を、既定権限に依存させない）。
revoke all on table public.rate_limit_reservations from public, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 予約: 枠があれば pending の行を作って予約IDを返す。無ければ行を作らず拒否する。
-- ----------------------------------------------------------------------------
create or replace function public.reserve_rate_limit_slot(
  p_key_hash text,
  p_confirmed_limit integer,
  p_inflight_limit integer,
  p_window_seconds integer,
  p_pending_ttl_seconds integer
) returns table (allowed boolean, reservation_id uuid, reason text, retry_after_seconds integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_start timestamptz;
  v_end timestamptz;
  v_confirmed integer;
  v_pending integer;
  v_id uuid;
begin
  if p_key_hash is null or char_length(p_key_hash) not between 16 and 128 then
    raise exception 'invalid rate limit key';
  end if;
  if p_confirmed_limit is null or p_confirmed_limit < 1 or p_confirmed_limit > 100000 then
    raise exception 'invalid confirmed limit';
  end if;
  if p_inflight_limit is null or p_inflight_limit < 1 or p_inflight_limit > 1000 then
    raise exception 'invalid inflight limit';
  end if;
  if p_window_seconds is null or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'invalid rate limit window';
  end if;
  if p_pending_ttl_seconds is null or p_pending_ttl_seconds < 1 or p_pending_ttl_seconds > 3600 then
    raise exception 'invalid pending ttl';
  end if;

  v_start := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  v_end := v_start + make_interval(secs => p_window_seconds);

  -- (key, window) 単位で直列化する。判定（数える）と挿入の間に他の要求が割り込めない。
  perform pg_advisory_xact_lock(hashtextextended(p_key_hash || ':' || extract(epoch from v_start)::text, 0));

  -- 古い行の回収（有界）。1日より古い行を最大20件まで削除する。
  delete from public.rate_limit_reservations
   where id in (
     select r.id from public.rate_limit_reservations r
      where r.created_at < now() - interval '1 day'
      limit 20
   );

  select count(*) filter (where r.state = 'confirmed'),
         count(*) filter (where r.state = 'pending' and r.expires_at > v_now)
    into v_confirmed, v_pending
    from public.rate_limit_reservations r
   where r.key_hash = p_key_hash and r.window_start = v_start;

  if v_confirmed >= p_confirmed_limit then
    allowed := false; reservation_id := null; reason := 'limit';
    retry_after_seconds := greatest(1, ceil(extract(epoch from (v_end - v_now)))::integer);
    return next; return;
  end if;

  if v_pending >= p_inflight_limit then
    allowed := false; reservation_id := null; reason := 'busy';
    retry_after_seconds := least(5, p_pending_ttl_seconds);
    return next; return;
  end if;

  insert into public.rate_limit_reservations (key_hash, window_start, state, expires_at)
  values (p_key_hash, v_start, 'pending', v_now + make_interval(secs => p_pending_ttl_seconds))
  returning id into v_id;

  allowed := true; reservation_id := v_id; reason := 'ok'; retry_after_seconds := 0;
  return next;
end;
$$;
revoke all on function public.reserve_rate_limit_slot(text, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.reserve_rate_limit_slot(text, integer, integer, integer, integer) to service_role;

-- ----------------------------------------------------------------------------
-- 確定 / 返却: 予約IDの行が pending のときだけ状態を変える（一度限り）。
-- 戻り値: 'confirmed' | 'released'（今回の呼び出しで変わった）/ 'noop'（既に確定・返却済み、または存在しない）
-- ----------------------------------------------------------------------------
create or replace function public.settle_rate_limit_slot(
  p_reservation_id uuid,
  p_outcome text
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new text;
  v_rows integer;
begin
  if p_reservation_id is null then
    raise exception 'invalid reservation id';
  end if;
  if p_outcome is null or p_outcome not in ('confirm', 'release') then
    raise exception 'invalid outcome';
  end if;
  v_new := case p_outcome when 'confirm' then 'confirmed' else 'released' end;

  -- pending の行だけを更新する。2回目以降（確定後の返却・返却後の確定・二重実行）は0行で何も変わらない。
  update public.rate_limit_reservations
     set state = v_new, resolved_at = now()
   where id = p_reservation_id
     and state = 'pending';
  get diagnostics v_rows = row_count;
  return case when v_rows > 0 then v_new else 'noop' end;
end;
$$;
revoke all on function public.settle_rate_limit_slot(uuid, text) from public, anon, authenticated;
grant execute on function public.settle_rate_limit_slot(uuid, text) to service_role;

-- ----------------------------------------------------------------------------
-- 古い予約の削除（運用で呼ぶ用。reserve_rate_limit_slot も有界の自動回収を行う）。
-- ----------------------------------------------------------------------------
create or replace function public.cleanup_rate_limit_reservations()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rows integer;
begin
  delete from public.rate_limit_reservations where created_at < now() - interval '1 day';
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
revoke all on function public.cleanup_rate_limit_reservations() from public, anon, authenticated;
grant execute on function public.cleanup_rate_limit_reservations() to service_role;

commit;
