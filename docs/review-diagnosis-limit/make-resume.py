#!/usr/bin/env python3
"""0058_diagnosis_change_limits.draft.sql の「関数・トリガー」部分（2〜6章）から、再開SQL(0058_resume.draft.sql)を作る。
本体と再開SQLの定義がずれないよう、手書きせず本体から機械的に作る（ずれの確認は resume-verify.sh が行う）。
使い方: python3 make-resume.py [出力先]   ※ローカルの検証・草案作成用。本番では実行しない（出力されたSQLだけを使う）。"""
import re, sys, pathlib
d = pathlib.Path(__file__).resolve().parent
src = (d / "0058_diagnosis_change_limits.draft.sql").read_text()
a = src.index("-- 2. 内部: 回数の判定と消費")
a = src.rfind("-- -----", 0, a)
b = src.index("-- 7. 既存データ")
b = src.rfind("-- -----", 0, b)
body = src[a:b]
body = re.sub(r"^create trigger (\w+) (?:before|after) [^\n]*? on (public\.\w+)",
              lambda m: f"drop trigger if exists {m.group(1)} on {m.group(2)};\n{m.group(0)}", body, flags=re.M)
head = """-- ============================================================================
-- 0058 再開SQL（草案・未適用）: 巻き戻し後に、制限の関数とトリガーを元どおり戻す
-- ============================================================================
-- ★このファイルは 0058_diagnosis_change_limits.draft.sql の2〜6章から機械的に作成したものです（手で編集しない）。
-- ★巻き戻し後は状態表が残っているため、0058本体の再実行（create table でエラーになる）では復旧できません。この再開SQLを使います。
--
-- 保持するもの（一切変更しない）:
--   diagnosis_change_limits（状態・変更回数・ロック日時）、diagnosis_save_requests（送信ID）、salon_culture_drafts（下書き）
-- 戻すもの: 関数（正規RPC・内部ゲート・状態取得・下書き・確定）と書き込み検査トリガー4つ（何度実行しても同じ結果）。
--
-- 巻き戻し中（制限が外れていた間）に保存された結果の扱い:
--   ・結果そのものは消さない（診断結果・サロンの確定結果は、そのまま残る）。
--   ・遡って回数を数えない・遡ってロックしない。状態表に記録のある人の変更回数・ロック日時は、巻き戻し前のまま。
--   ・状態表に記録が無い人（巻き戻し中に初めて保存した人など）は、末尾で「初回保存済み・ロックなし」の状態を作る
--     （0058本体の既存会員の扱いと同じ。導入後に1回変更でき、保存成功の時点から3か月ロック）。
--   ・巻き戻し中に変更して保存した人が、再開時点でロック中なら、その結果は残したまま、次回変更可能日時まで変更できない。
--   適用前に 0058_resume_precheck.sql で、状態表に記録されていない保存の件数を確認できる。
--
-- 0059（旧入口の権限整理）は巻き戻しで元に戻っている。再開後に必要なら、アプリ切替を確認してから別途適用する。
begin;

do $$
begin
  if to_regclass('public.diagnosis_change_limits') is null
     or to_regclass('public.diagnosis_save_requests') is null
     or to_regclass('public.salon_culture_drafts') is null then
    raise exception 'resume refused: 0058 state tables not found. Use 0058_diagnosis_change_limits.draft.sql for a first-time apply.';
  end if;
end $$;

"""
m = re.search(r"comment on table public.diagnosis_change_limits is\s*\n?\s*('(?:[^']|'')*');", src)
assert m, "状態表のコメントが見つからない"
tail = """-- 巻き戻しの時刻の記録を、元のコメントに戻す
comment on table public.diagnosis_change_limits is
  """ + m.group(1) + """;

-- ---------------------------------------------------------------------------
-- 7. 状態表に記録の無い所有者だけ、「初回保存済み・ロックなし」の状態を作る（既にある記録は変更しない）
-- ---------------------------------------------------------------------------
insert into public.diagnosis_change_limits (kind, user_id, initial_saved_at)
select case when mode = 'stylist' then 'stylist' else 'salon_quiz' end, user_id, min(created_at)
  from public.diagnosis_results group by 1, user_id
on conflict do nothing;
insert into public.diagnosis_change_limits (kind, user_id, initial_saved_at)
select 'salon_culture_user', salon_user_id, created_at from public.salon_culture_profiles where status = 'completed'
on conflict do nothing;
insert into public.diagnosis_change_limits (kind, store_id, initial_saved_at)
select 'salon_culture_store', store_id, created_at from public.salon_store_culture_profiles where status = 'completed'
on conflict do nothing;

commit;
"""
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else d / "0058_resume.draft.sql"
out.write_text(head + body + tail)
print(out)
