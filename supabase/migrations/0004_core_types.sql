-- ============================================================================
-- Beauty Reach — 0004_core_types
--
-- Beauty Reach 8タイプ（front-facing称号）の導入。
--
-- 設計方針（要件定義書 requirements-v1.0.md 12.1節・チャットでの承認内容）:
--   ・既存の12タイプ（diagnosis_results.type_id/type_name）は削除・変更しない。
--     12タイプ＝内部詳細レイヤー、8タイプ＝表側の称号、という二層構造。
--   ・「コアタイプ」（比較的変わりにくい本人の土台）と「現在の傾向」（直近診断の
--     候補）を明確に分離する。コアタイプは初回診断時にのみ設定し、再診断では
--     自動的に上書きしない。
--   ・重要データ（将来のサロンマッチング・スカウト・AIプロフィール・キャリア提案に
--     利用する）であるため、クライアントから任意の core_type_code / top_type_code /
--     match_scores を直接書き込める構造にはしない。
--       - SELECT: 本人のみ可能（GRANT + RLS）
--       - 直接INSERT/UPDATE: クライアントには一切許可しない（GRANTを与えない）
--       - 書き込みは save_core_type_result() RPCからのみ。このRPCは
--         diagnosis_results に既に保存されている「サーバー側で確定済みの生スコア」
--         を自分で読み出し、SQL側で独自に8タイプのmatchScoreを再計算する。
--         クライアントが渡せるのは diagnosis_result_id（＝どの診断を対象にするか）
--         だけであり、計算結果そのものをパラメータとして渡すことはできない。
-- ============================================================================

-- ---------- 1. enum の作成 --------------------------------------------------
create type public.stylist_core_type as enum (
  'shimei_jishaku',   -- 指名磁石
  'aisare_ace',       -- 愛されエース
  'niaiwase_master',  -- 似合わせマスター
  'trend_maker',      -- トレンドメーカー
  'iyashi_charisma',  -- 癒しのカリスマ
  'repeat_king',      -- リピートキング
  'mirai_no_ace',     -- 未来のエース
  'brand_builder'     -- ブランドビルダー
);

-- ---------- 2. 履歴テーブル（診断のたびに1行、追記のみ） -------------------
create table public.stylist_core_type_history (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles(id) on delete cascade,
  diagnosis_result_id uuid not null references public.diagnosis_results(id) on delete cascade,
  top_type_code       public.stylist_core_type not null,
  second_type_code    public.stylist_core_type not null,
  score_gap           numeric not null,
  match_scores        jsonb not null,
  created_at          timestamptz not null default now(),
  unique (diagnosis_result_id)
);
comment on table public.stylist_core_type_history is '8タイプ判定の履歴。診断のたびに1行追加される「現在の傾向」の記録。書き込みはsave_core_type_result() RPC経由のみ。過去の行は変更しない（追記のみ）。';
comment on column public.stylist_core_type_history.score_gap is '1位と2位のmatchScoreの差。将来の確信度・安定性判定の元データ。';
comment on column public.stylist_core_type_history.match_scores is '全8タイプ分の生matchScore（jsonb）。将来の閾値調整・安定性判定に使う。単にタイプ名だけを保存する設計にはしていない。';

create index stylist_core_type_history_user_idx on public.stylist_core_type_history (user_id, created_at desc);

-- ---------- 3. コアタイプ確定テーブル（ユーザーごとに最大1行） -------------
create table public.stylist_core_type_assignments (
  user_id                    uuid primary key references public.profiles(id) on delete cascade,
  core_type_code             public.stylist_core_type not null,
  source_diagnosis_result_id uuid not null references public.diagnosis_results(id),
  assignment_method          text not null default 'initial' check (assignment_method in ('initial', 'stability_algorithm')),
  assigned_at                timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
comment on table public.stylist_core_type_assignments is '「本人の土台」として確定したコアタイプ。ユーザーごとに最大1行。初回診断時にのみ作成し、再診断では自動的に上書きしない（save_core_type_result()がON CONFLICT DO NOTHINGで保護する）。将来、直近複数回の結果・1位2位の差・スコア変化量等から更新するアルゴリズム（assignment_method=stability_algorithm）を追加できるよう、更新用のUPDATE権限は現時点では誰にも与えていない（将来専用RPCを追加する想定）。';

create trigger trg_stylist_core_type_assignments_updated
  before update on public.stylist_core_type_assignments
  for each row execute function public.set_updated_at();

-- ---------- 4. RLS（SELECTのみ許可。INSERT/UPDATEは一切許可しない） --------
alter table public.stylist_core_type_history enable row level security;
create policy stylist_core_type_history_select_own on public.stylist_core_type_history
  for select using (user_id = auth.uid());

alter table public.stylist_core_type_assignments enable row level security;
create policy stylist_core_type_assignments_select_own on public.stylist_core_type_assignments
  for select using (user_id = auth.uid());

grant select on public.stylist_core_type_history to authenticated;
grant select on public.stylist_core_type_assignments to authenticated;
-- INSERT/UPDATEは意図的に一切GRANTしない。書き込みはsave_core_type_result() RPCのみ。

-- ---------- 5. save_core_type_result RPC ------------------------------------
-- クライアントから受け取るのは diagnosis_result_id のみ。8タイプのmatchScore・
-- 上位2件・差は、diagnosis_results に既に保存されている本人所有の生スコアから
-- このRPC自身がSQLで再計算する（クライアントが計算結果を偽って渡すことはできない）。
--
-- ★重要: ここで使う重み配分は lib/diagnosis/core-types.ts の CORE_TYPE_WEIGHTS と
-- 完全に一致させること。ズレるとTS側のテストと結果が食い違う。変更する場合は
-- 必ず両方を同時に更新すること。
create or replace function public.save_core_type_result(
  p_diagnosis_result_id uuid
) returns public.stylist_core_type_history
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_diag public.diagnosis_results;
  v_match jsonb := '{}'::jsonb;
  v_score numeric;
  v_top public.stylist_core_type;
  v_top_score numeric;
  v_second public.stylist_core_type;
  v_second_score numeric;
  v_history public.stylist_core_type_history;
  w record;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_diag
  from public.diagnosis_results
  where id = p_diagnosis_result_id and user_id = v_uid;

  if not found then
    raise exception 'diagnosis_result not found or not owned by caller';
  end if;

  -- 8タイプ分のmatchScoreをSQL側で独自に算出する（クライアント入力は一切使わない）。
  for w in
    select * from (values
      ('shimei_jishaku'::public.stylist_core_type,  0.20, 0.00, 0.50, 0.30, 0.00, 0.00),
      ('aisare_ace',       0.35, 0.00, 0.45, 0.00, 0.00, 0.20),
      ('niaiwase_master',  0.50, 0.35, 0.15, 0.00, 0.00, 0.00),
      ('trend_maker',      0.00, 0.50, 0.00, 0.35, 0.15, 0.00),
      ('iyashi_charisma',  0.00, 0.20, 0.50, 0.00, 0.00, 0.30),
      ('repeat_king',      0.35, 0.00, 0.40, 0.00, 0.25, 0.00),
      ('mirai_no_ace',     0.30, 0.00, 0.00, 0.20, 0.50, 0.00),
      ('brand_builder',    0.00, 0.00, 0.00, 0.45, 0.20, 0.35)
    ) as t(code, wt, ws, wh, wb, wa, wm)
  loop
    v_score := w.wt * v_diag.craft_score
             + w.ws * v_diag.sense_score
             + w.wh * v_diag.hospitality_score
             + w.wb * v_diag.brand_score
             + w.wa * v_diag.drive_score
             + w.wm * v_diag.mentor_score;
    v_match := v_match || jsonb_build_object(w.code, round(v_score, 1));
  end loop;

  -- 上位2件を抽出する。
  select (kv.key)::public.stylist_core_type, (kv.value)::numeric
    into v_top, v_top_score
  from jsonb_each_text(v_match) as kv
  order by (kv.value)::numeric desc
  limit 1;

  select (kv.key)::public.stylist_core_type, (kv.value)::numeric
    into v_second, v_second_score
  from jsonb_each_text(v_match) as kv
  where (kv.key)::public.stylist_core_type <> v_top
  order by (kv.value)::numeric desc
  limit 1;

  -- 履歴へ追加（同一診断への重複呼び出しは冪等に既存行を返す）。
  insert into public.stylist_core_type_history (
    user_id, diagnosis_result_id, top_type_code, second_type_code, score_gap, match_scores
  ) values (
    v_uid, p_diagnosis_result_id, v_top, v_second, round(v_top_score - v_second_score, 1), v_match
  )
  on conflict (diagnosis_result_id) do nothing
  returning * into v_history;

  if not found then
    select * into v_history
    from public.stylist_core_type_history
    where diagnosis_result_id = p_diagnosis_result_id;
  end if;

  -- コアタイプは初回のみ確定する。既に存在する場合は一切上書きしない
  -- （ON CONFLICT DO NOTHING）。将来の安定性アルゴリズムによる更新は
  -- 別途専用の仕組み（assignment_method='stability_algorithm'）で行う想定。
  insert into public.stylist_core_type_assignments (
    user_id, core_type_code, source_diagnosis_result_id, assignment_method
  ) values (
    v_uid, v_top, p_diagnosis_result_id, 'initial'
  )
  on conflict (user_id) do nothing;

  return v_history;
end;
$$;
comment on function public.save_core_type_result is '8タイプ判定を保存する唯一の経路。クライアントはdiagnosis_result_idのみ渡し、matchScore等の計算結果はこのRPCが診断結果の生スコアから独自に再計算する（クライアントが計算結果を偽って渡すことはできない）。履歴への追加は冪等。コアタイプの確定は初回のみで、以後は上書きしない。SECURITY DEFINER、固定search_path。';

revoke all on function public.save_core_type_result(uuid) from public;
revoke all on function public.save_core_type_result(uuid) from anon;
grant execute on function public.save_core_type_result(uuid) to authenticated;
