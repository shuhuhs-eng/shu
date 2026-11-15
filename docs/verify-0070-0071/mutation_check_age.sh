#!/bin/bash
# 年齢仕様の検証が「壊れた実装」を検出できることの確認（ローカル専用・使い捨てDBのみ）。
# 0070草案の写しに、わざと誤った変更（変異）を1つずつ入れて 0070_verify_age.sql を実行し、FAIL行またはSQLエラーが出ること（=検出）を確認する。
# 検出できなかった変異が1つでもあれば非ゼロで終了する。
D=$(cd "$(dirname "$0")" && pwd)
. "$D/verify_common.sh"
vfy_preflight 0070_stylist_profile_public.draft.sql 0070_fixture.sql 0070_verify_age.sql stub_supabase.sql
vfy_ensure_template
DB=vfy_mut_$$; trap 'vdb_drop $DB; rm -f "$VFY_TMPD"/mut.sql' EXIT
src=$(ffind 0070_stylist_profile_public.draft.sql)
mut() { # 名前 sed式
  vdb_drop $DB 2>/dev/null; vdb_create $DB "$VFY_TPL"
  vpsql -d $DB -f "$(ffind 0070_fixture.sql)" >/dev/null || vfy_die "fixture 失敗"
  sed "$2" "$src" > "$VFY_TMPD/mut.sql"
  if cmp -s "$src" "$VFY_TMPD/mut.sql"; then echo "FAIL  変異が適用されていない（置換対象が見つからない）: $1"; VFY_FAIL=$((VFY_FAIL+1)); return; fi
  vpsql -d $DB -f "$VFY_TMPD/mut.sql" >/dev/null 2>&1 || { echo "FAIL  変異版の適用に失敗: $1"; VFY_FAIL=$((VFY_FAIL+1)); return; }
  local out; out=$(psql -X -Atq -d $DB -v ON_ERROR_STOP=1 -f "$(ffind 0070_verify_age.sql)" 2>&1)
  local n; n=$(echo "$out" | grep -c '|FAIL|'); local e; e=$(echo "$out" | grep -c 'ERROR:')
  if [ "$n" -gt 0 ] || [ "$e" -gt 0 ]; then echo "PASS  検出: $1（FAIL行 $n / SQLエラー $e）"; VFY_PASS=$((VFY_PASS+1)); else echo "FAIL  検出できない変異: $1"; VFY_FAIL=$((VFY_FAIL+1)); fi
}
mut "年代表示でも常に実年齢を返す" "s/case when v_mode = 'exact' or v_status = 'approved' then/case when true then/"
mut "承認を店舗で絞らず、どの店舗にも開示する" "s/if p_store_id is not null then/if true then v_status := (select status from public.age_disclosure_requests where stylist_user_id = p_stylist_user_id order by decided_at limit 1); end if; if false then/"
mut "公開判定から表示方法の条件を外す" "s/sp.birth_date is not null and sp.age_display_mode is not null/sp.birth_date is not null/"
mut "公開判定から生年月日の条件を外す（表示方法だけ）" "s/sp.birth_date is not null and sp.age_display_mode is not null/sp.age_display_mode is not null/"
mut "年代表示なら未成年の保留を免除する" "s/(public.stylist_age_years(sp.birth_date) >= 18/(public.stylist_age_years(sp.birth_date) >= 18 or sp.age_display_mode = 'decade'/"
mut "生年月日のNULL戻しを許す" "s/if old.birth_date is not null and new.birth_date is null then/if false then/"
mut "プロフィール保存で生年月日を必須にしない" "s/if not exists (select 1 from public.stylist_private where user_id = new.user_id and birth_date is not null) then/if false then/"
mut "他人の依頼でも承認できる" "s/where id = p_request_id and stylist_user_id = v_uid for update/where id = p_request_id for update/"
mut "逆の決定を許す（二重処理で状態が壊れる）" "s/elsif v_req.status is distinct from v_want then/elsif false then/"
mut "閲覧専用メンバーも依頼できる" "s/if not public.can_manage_store_hiring(p_store_id) then raise exception 'not allowed to request for this store'; end if;/null;/"
mut "承認しても未成年の保留を解除する（保留判定を承認で免除）" "s/or v_mode is null or not public.stylist_salon_publishable(p_stylist_user_id) then/or v_mode is null then/"
mut "年齢情報に生年月日を含める" "s/'age_decade', (v_age \/ 10) \* 10,/'age_decade', (v_age \/ 10) * 10, 'birth_date', v_birth,/"
vfy_exit
