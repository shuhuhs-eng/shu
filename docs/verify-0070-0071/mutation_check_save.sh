#!/bin/bash
# 一括保存（save_stylist_profile_v2）の検証 age_save_verify.sh が「壊れた実装」を検出できることの確認（ローカル専用）。
D=$(cd "$(dirname "$0")" && pwd)
. "$D/verify_common.sh"
vfy_preflight 0070_stylist_profile_public.draft.sql 0070_fixture.sql age_save_verify.sh stub_supabase.sql
vfy_ensure_template
trap 'rm -rf "$VFY_TMPD"' EXIT
src=$(ffind 0070_stylist_profile_public.draft.sql)
mut() {
  sed "$2" "$src" > "$VFY_TMPD/mutsave.sql"
  if cmp -s "$src" "$VFY_TMPD/mutsave.sql"; then echo "FAIL  変異が適用されていない: $1"; VFY_FAIL=$((VFY_FAIL+1)); return; fi
  local out rc; out=$(VFY_DRAFT="$VFY_TMPD/mutsave.sql" TEMPLATE_DB="$VFY_TPL" bash "$(ffind age_save_verify.sh)" 2>&1); rc=$?
  if [ $rc -ne 0 ]; then echo "PASS  検出: $1（age_save_verify 終了コード $rc / FAIL行 $(echo "$out" | grep -c '^FAIL')）"; VFY_PASS=$((VFY_PASS+1)); else echo "FAIL  検出できない変異: $1"; VFY_FAIL=$((VFY_FAIL+1)); fi
}
mut "プロフィール保存トリガーが表示方法の未選択を許す" "s/and age_display_mode is not null) then/and true) then/"
mut "v2が表示方法の未選択を許す（NULL/不正値）" "s/if p_age_display_mode is null or p_age_display_mode not in ('exact','decade') then/if false then/"
mut "v2が生年月日の欠落を許す" "s/if p_birth_date is null then raise exception 'birth_date_required' using hint = '生年月日を登録してください'; end if;/null;/"
mut "v2がプロフィール保存の失敗を握りつぶし、生年月日・表示方法だけ残る（非原子的）" "s/  v_profile := public.save_stylist_profile(/  begin v_profile := public.save_stylist_profile(/; s/p_desired_salary_range, p_sns_links, p_bio, p_visibility, p_scout_enabled, p_avatar_path, p_value_priorities);/p_desired_salary_range, p_sns_links, p_bio, p_visibility, p_scout_enabled, p_avatar_path, p_value_priorities); exception when others then v_profile := null; end;/"
vfy_exit
