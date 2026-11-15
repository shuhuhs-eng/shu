#!/bin/bash
# 検証スクリプト共通部品（ローカル専用。source して使う）。本番DBには接続しない。
#
# 【前提（実行前に preflight が確認し、満たさなければDBを触る前に止まる）】
#   ・PostgreSQL 15 以上のローカルサーバーに、スーパーユーザーとして psql で接続できること
#       例: su postgres -c "bash run_all_0070_0071.sh"   または  PGHOST/PGUSER/PGPASSWORD を設定
#   ・既存migration 0001〜0061（同梱の migrations/ か、リポジトリの supabase/migrations か、環境変数 MIGRATIONS_DIR）
#     もしくは、同等のテンプレートDB（環境変数 TEMPLATE_DB。0061までの適用済みスキーマ＋Supabase互換スタブ）
#   ・0058（診断の変更回数制限）のSQL本体 0058_diagnosis_change_limits.draft.sql が同じ場所にあること
# 【DBの扱い】作成・削除するのは「vfy_」で始まり、かつ印（コメント）の付いた使い捨てDBだけ。
#   それ以外の名前・印なしのDBは、存在しても削除しない（衝突したら止まる）。
VFY_MARK='beauty-reach-verify-disposable'
VFY_D="${VFY_D:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
VFY_SEARCH="$VFY_D $VFY_D/../review-diagnosis-limit $VFY_D/../stylist-profile-db $VFY_D/../student-newgrad-db $VFY_D/../verify-0070-0071"
vfy_die() { echo "ERROR: $*" >&2; exit 2; }
ffind() { local d; for d in $VFY_SEARCH; do [ -f "$d/$1" ] && { echo "$(cd "$d" && pwd)/$1"; return 0; }; done; return 1; }
need_files() { local f miss=""; for f in "$@"; do ffind "$f" >/dev/null || miss="$miss $f"; done
  [ -z "$miss" ] || vfy_die "必要なファイルが見つかりません（同じディレクトリに置いてください）:$miss"; }
vpsql() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
vq() { psql -X -Atq -v ON_ERROR_STOP=0 "$@" 2>&1; }

vfy_preflight() { # 引数: 必要なファイル名…
  command -v psql >/dev/null || vfy_die "psql が見つかりません（PostgreSQL 15 以上のクライアントが必要）"
  local sup ver
  sup=$(psql -X -Atq -d postgres -c "select rolsuper from pg_roles where rolname = current_user" 2>&1) || vfy_die "PostgreSQL に接続できません: $sup"
  [ "$sup" = "t" ] || vfy_die "スーパーユーザーで接続してください（例: su postgres -c 'bash run_all_0070_0071.sh'）"
  ver=$(psql -X -Atq -d postgres -c "show server_version_num")
  [ "${ver:-0}" -ge 150000 ] || vfy_die "PostgreSQL 15 以上が必要です（現在: $ver）"
  [ $# -eq 0 ] || need_files "$@"
}
vdb_ok_name() { [[ "$1" =~ ^vfy_[a-z0-9_]+$ ]] || vfy_die "安全のため、使い捨てDB名は vfy_ で始まる英小文字・数字・_ のみ: $1"; }
vdb_marked() { [ "$(psql -X -Atq -d postgres -c "select coalesce(shobj_description(oid,'pg_database'),'') from pg_database where datname='$1'")" = "$VFY_MARK" ]; }
vdb_exists() { [ "$(psql -X -Atq -d postgres -c "select count(*) from pg_database where datname='$1'")" = "1" ]; }
vdb_drop() { vdb_ok_name "$1"
  if vdb_exists "$1"; then vdb_marked "$1" || vfy_die "$1 は検証用の印がないため削除しません（別の用途のDBの可能性）"
    psql -X -q -d postgres -c "drop database \"$1\" with (force)" >/dev/null || vfy_die "$1 を削除できません"; fi; }
vdb_create() { # 名前 [テンプレート]
  vdb_ok_name "$1"; vdb_drop "$1"
  if [ -n "${2:-}" ]; then psql -X -q -d postgres -c "create database \"$1\" template \"$2\"" >/dev/null || vfy_die "DB作成に失敗: $1（テンプレート $2 に接続中のセッションがないか確認）"
  else psql -X -q -d postgres -c "create database \"$1\"" >/dev/null || vfy_die "DB作成に失敗: $1"; fi
  psql -X -q -d postgres -c "comment on database \"$1\" is '$VFY_MARK'" >/dev/null; }

VFY_ERR="${TMPDIR:-/tmp}/vfy_mig_err.$$"
VFY_TEMPLATE_NAME="${VFY_TEMPLATE_NAME:-vfy_tpl_0061}"
vfy_migrations_dir() { local c; for c in "${MIGRATIONS_DIR:-}" "$VFY_D/migrations" "$VFY_D/../../supabase/migrations"; do [ -n "$c" ] && [ -f "$c/0001_init.sql" ] && { echo "$c"; return 0; }; done; return 1; }
# テンプレートDB名を VFY_TPL に設定（無ければ migration から作る）
vfy_ensure_template() {
  if [ -n "${TEMPLATE_DB:-}" ]; then
    vdb_exists "$TEMPLATE_DB" || vfy_die "TEMPLATE_DB=$TEMPLATE_DB が存在しません"
    [ "$(psql -X -Atq -d "$TEMPLATE_DB" -c "select to_regclass('public.stylist_private') is not null and to_regclass('public.admin_visit_cases') is not null")" = "t" ] \
      || vfy_die "TEMPLATE_DB=$TEMPLATE_DB は 0061 までのスキーマではありません（stylist_private / admin_visit_cases が無い）"
    VFY_TPL="$TEMPLATE_DB"; return 0; fi
  VFY_TPL="$VFY_TEMPLATE_NAME"
  if vdb_exists "$VFY_TPL" && vdb_marked "$VFY_TPL" && [ "$(psql -X -Atq -d "$VFY_TPL" -c "select to_regclass('public.admin_visit_cases') is not null")" = "t" ]; then return 0; fi
  local mig; mig=$(vfy_migrations_dir) || vfy_die "migration が見つかりません。MIGRATIONS_DIR（0001〜0061のSQLがあるディレクトリ）か TEMPLATE_DB を指定してください"
  need_files stub_supabase.sql
  echo "== テンプレートDB $VFY_TPL を migration から作成（初回のみ）: $mig"
  vdb_create "$VFY_TPL"
  vpsql -d "$VFY_TPL" -f "$(ffind stub_supabase.sql)" >/dev/null || vfy_die "スタブの適用に失敗"
  local f n
  for f in $(ls "$mig"/*.sql | sort); do n=$(basename "$f" | cut -c1-4)
    [ "$n" -le 0061 ] || continue
    vpsql -d "$VFY_TPL" -f "$f" >/dev/null 2>"$VFY_ERR" || { echo "migration 失敗: $f" >&2; grep -v NOTICE "$VFY_ERR" | head -5 >&2; rm -f "$VFY_ERR"; vdb_drop "$VFY_TPL"; vfy_die "テンプレート作成に失敗"; }
  done; rm -f "$VFY_ERR"
}
# SQL検証ファイルを実行し、SQLエラー・FAIL行・PASS行ゼロ を失敗として扱う。引数: DB 名前(表示用) ファイル [psql追加引数…]
# 出力は $VFY_OUT に残す。戻り値 0=合格 / 1=失敗
vfy_run_sql() {
  local db=$1 label=$2 file=$3; shift 3
  VFY_OUT=$(psql -X -q -v ON_ERROR_STOP=1 "$@" -d "$db" -f "$file" 2>&1); local rc=$?
  local nf np
  nf=$(printf '%s\n' "$VFY_OUT" | grep -cE '(\| *FAIL *\||^ *FAIL *\||HAS FAIL|^FAIL )')
  np=$(printf '%s\n' "$VFY_OUT" | grep -cE '(\| *PASS *\||ALL PASS)')
  if [ $rc -ne 0 ]; then echo "FAIL  $label: SQLエラー (psql 終了コード $rc)"; printf '%s\n' "$VFY_OUT" | grep -E 'ERROR|FATAL' | head -3; return 1; fi
  if [ "$nf" -gt 0 ]; then echo "FAIL  $label: 失敗した検証 $nf 件"; printf '%s\n' "$VFY_OUT" | grep -E '(\| *FAIL *\||^ *FAIL *\||HAS FAIL|^FAIL )' | head -5; return 1; fi
  if [ "$np" -eq 0 ]; then echo "FAIL  $label: 合格行が1件も出力されていない（検証が実行されていない）"; return 1; fi
  echo "PASS  $label: 合格行 $np 件"; return 0; }
# 結果集計（スクリプト末尾で vfy_exit を呼ぶ）
VFY_PASS=0; VFY_FAIL=0
vfy_chk() { if [ "$2" = "$3" ]; then echo "PASS  $1"; VFY_PASS=$((VFY_PASS+1)); else echo "FAIL  $1  (期待: $3 / 実際: $2)"; VFY_FAIL=$((VFY_FAIL+1)); fi; }
vfy_has() { if printf '%s' "$2" | grep -q "$3"; then echo "PASS  $1"; VFY_PASS=$((VFY_PASS+1)); else echo "FAIL  $1  (出力に「$3」なし: $(printf '%s' "$2" | head -c 150))"; VFY_FAIL=$((VFY_FAIL+1)); fi; }
vfy_record() { # rc ラベル
  if [ "$1" -eq 0 ]; then VFY_PASS=$((VFY_PASS+1)); else VFY_FAIL=$((VFY_FAIL+1)); fi; }
vfy_exit() { echo "-- 結果: PASS $VFY_PASS / FAIL $VFY_FAIL"; [ "$VFY_FAIL" -eq 0 ] && exit 0 || exit 1; }
# バックグラウンド処理が別接続でロック待ちになっているか（pg_stat_activity）を、上限つきで待つ。引数: DB 問い合わせ断片 秒
vfy_wait_blocked() {
  local db=$1 frag=$2 secs=${3:-10} i n
  for i in $(seq 1 $((secs*10))); do
    n=$(psql -X -Atq -d "$db" -c "select count(*) from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and query like '%$frag%' and pid<>pg_backend_pid()")
    [ "${n:-0}" -ge 1 ] && return 0; sleep 0.1; done; return 1; }

# ---- 検証用DBの構築 ----
# vfy_build_chain DB 段階(0058|0070|0071): テンプレート → 0058 → 0070 → 0071 の順に適用（適用順は 0070→0071 固定）
vfy_build_chain() {
  local db=$1 stage=$2 f
  vdb_create "$db" "$VFY_TPL"
  for f in 0058_diagnosis_change_limits.draft.sql $( [ "$stage" != 0058 ] && echo 0070_stylist_profile_public.draft.sql ) $( [ "$stage" = 0071 ] && echo 0071_student_newgrad.draft.sql ); do
    vpsql -d "$db" -f "$(ffind "$f")" >/dev/null 2>"$VFY_ERR" || { echo "適用失敗: $f" >&2; grep -v NOTICE "$VFY_ERR" | head -3 >&2; vfy_die "$db の構築に失敗（$f）"; }
  done; }
# 0070 の fixture 付き（0058不要）: テンプレート → fixture → 0070
vfy_build_0070_fixture() {
  vdb_create "$1" "$VFY_TPL"
  vpsql -d "$1" -f "$(ffind 0070_fixture.sql)" >/dev/null || vfy_die "fixture 失敗: $1"
  vpsql -d "$1" -f "${VFY_DRAFT:-$(ffind 0070_stylist_profile_public.draft.sql)}" >/dev/null 2>&1 || vfy_die "0070 適用失敗: $1"; }
# ---- 並行実行の補助 ----
VFY_TMPD="${VFY_TMPD:-$(mktemp -d "${TMPDIR:-/tmp}/vfy.XXXXXX")}"
# vfy_bg 名前 コマンド…: バックグラウンドで実行し、出力を $VFY_TMPD/名前.out、終了コードを $VFY_TMPD/名前.rc に残す
vfy_bg() { local n=$1; shift; rm -f "$VFY_TMPD/$n.rc"; ( "$@" >"$VFY_TMPD/$n.out" 2>&1; echo $? >"$VFY_TMPD/$n.rc" ) & VFY_LAST_PID=$!; }
# vfy_join 名前…: 完了を待つ（上限60秒）。終了コードは vfy_rc 名前 で読む
vfy_join() { local n i; for n in "$@"; do for i in $(seq 1 600); do [ -f "$VFY_TMPD/$n.rc" ] && break; sleep 0.1; done; [ -f "$VFY_TMPD/$n.rc" ] || { echo "FAIL  $n が60秒以内に終了しない"; VFY_FAIL=$((VFY_FAIL+1)); echo 99 >"$VFY_TMPD/$n.rc"; }; done; }
vfy_rc() { cat "$VFY_TMPD/$1.rc" 2>/dev/null || echo 99; }
vfy_out() { cat "$VFY_TMPD/$1.out" 2>/dev/null; }
# vfy_wait_query DB 断片 秒: 実行中（active）のセッションに、その文字列を含む問い合わせがあるまで待つ（保持側の確認用）
vfy_wait_query() { local db=$1 frag=$2 secs=${3:-10} i n
  for i in $(seq 1 $((secs*10))); do
    n=$(psql -X -Atq -d "$db" -c "select count(*) from pg_stat_activity where datname=current_database() and state='active' and query like '%$frag%' and pid<>pg_backend_pid()"); [ "${n:-0}" -ge 1 ] && return 0; sleep 0.1; done; return 1; }
# ロック待ちが実際に発生したことを確認して記録する: vfy_expect_blocked DB 断片 ラベル
vfy_expect_blocked() { if vfy_wait_blocked "$1" "$2" 10; then echo "PASS  $3: ロック待ちを実際に確認"; VFY_PASS=$((VFY_PASS+1)); else echo "FAIL  $3: ロック待ちが発生していない（保護が効いていない、または保持側が動いていない）"; VFY_FAIL=$((VFY_FAIL+1)); fi; }
vfy_expect_held() { if vfy_wait_query "$1" "$2" 10; then :; else echo "FAIL  $3: 保持側の処理が始まっていない"; VFY_FAIL=$((VFY_FAIL+1)); fi; }
