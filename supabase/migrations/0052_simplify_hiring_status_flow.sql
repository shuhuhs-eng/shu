-- ============================================================================
-- 0052: 採用ステータスの簡素化（「内定 = 採用」。ユーザー向けフローから「内定」を廃止）（Phase 53）
-- ============================================================================
-- 新しい採用進捗:
--   連絡調整中 → 面談予定 → 面談済み → 選考中 → 採用
--
-- 方針:
--   ・status の 'offered' は削除しない（過去データ・event履歴・既存migrationとの整合）。
--   ・既存の offered 行・履歴は一切更新しない（一括で hired にしない。請求の自動発生を防ぐ）。
--     既存 offered は、店舗が正式に「採用」を押したときだけ hired へ進む（offered → hired は互換で残す）。
--   ・新規の「採用」操作は offered を経由しない:
--       selection → hired を許可（hired は終端のまま）。
--       interview_completed / selection → offered は禁止（新しい offered を作らない）。
--       これにより、新規フローでは 0038 の hiring_offered 通知も発生しない
--       （通知は offered への遷移イベントで作られるため。通知typeの定義自体は残す）。
--   ・成功報酬は 0039 のトリガー（status = 'hired' になった行で1件だけ作成。unique(hiring_process_id)）。
--     起点は変更しない。selection → hired でも同じトリガーが同じように1件だけ作る。
--   ・採用分析: hiring_stage_rank()（0041。0041/0042 の集計RPCが使う）を再定義する。
--       offered を selection と同じ段階(4)に扱い、「内定到達」に数えない。hired は従来どおり 6。
--       rank 5 は未使用（過去の「内定」段階）。集計RPCの offered_count(=到達順位>=5) は hired と同数になるため、
--       画面では「内定」列を表示しない（互換のため項目自体はRPCの戻り値に残る）。
--       採用件数は hired のみ。過去に offered を経由して hired になった人も、
--       「選考到達」「採用」に数えられる（offered 履歴があっても採用に数えない／二重に数えない）。
--       0041/0042 の集計RPC本体は再定義しない。
--   ・0001〜0051 は変更しない。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- A. 遷移表（0037 の hiring_transition_allowed を再定義。シグネチャ・属性は同一）
-- ----------------------------------------------------------------------------
create or replace function public.hiring_transition_allowed(p_from text, p_to text)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_from
    when 'contacting'          then p_to in ('interview_scheduled', 'rejected', 'declined')
    when 'interview_scheduled' then p_to in ('interview_scheduled', 'interview_completed', 'contacting', 'rejected', 'declined')
    when 'interview_completed' then p_to in ('interview_scheduled', 'selection', 'rejected', 'declined')
    when 'selection'           then p_to in ('interview_scheduled', 'hired', 'rejected', 'declined')
    -- 過去データ互換: 既存の offered は、従来どおり選考中へ戻す・採用・不採用・辞退ができる。
    when 'offered'             then p_to in ('selection', 'hired', 'rejected', 'declined')
    when 'declined'            then p_to in ('contacting')
    when 'rejected'            then p_to in ('contacting')
    else false  -- hiredは終端
  end;
$$;
revoke all on function public.hiring_transition_allowed(text, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- B. 採用分析の段階（0041 の hiring_stage_rank を再定義。シグネチャ・属性は同一）
-- ----------------------------------------------------------------------------
create or replace function public.hiring_stage_rank(p_status text)
returns integer
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_status
    when 'contacting' then 1
    when 'interview_scheduled' then 2
    when 'interview_completed' then 3
    when 'selection' then 4
    when 'offered' then 4   -- 過去データ: 選考中と同じ段階。「内定到達」「採用」には数えない
    when 'hired' then 6
    else 0
  end;
$$;
revoke all on function public.hiring_stage_rank(text) from public, anon, authenticated;

commit;
