#!/bin/bash
# 0061 同時実行テスト（ローカル検証用）。複数の psql セッションを並行して走らせ、結果を検証する。
# 使い方: bash 0061_concurrency.sh <DB名>   ※0060→0061適用済みで、固定データを「コミット」する専用DBで実行（本番では実行しない）
DB=${1:-hcc}; OUT=/tmp/seqout/cc; rm -f $OUT/*.out
U=00000000-0000-0000-0000-00000000f
A=00000000-0000-0000-0000-0000000f0a01; A1=00000000-0000-0000-0000-0000000f0a11
pass=0; fail=0
# 同時スタートの仕掛け: 先にロックを握るセッションを走らせ、全セッションをそこで待たせてから一斉に解放する
gate(){ psql -X -q -At -d $DB -c "select pg_advisory_lock(7777001), pg_sleep(${1:-4})" >/dev/null & sleep 0.5; }
ok(){ if [ "$2" = "1" ]; then echo "PASS $1"; pass=$((pass+1)); else echo "FAIL $1 :: $3"; fail=$((fail+1)); fi; }
q(){ psql -X -At -d $DB -c "$1"; }
as(){ # as <uid番号> <sql>  -> 結果の最終行（エラーは ERR:メッセージ）
  local uid=$U$(printf %03d $1)
  local o; o=$(psql -X -At -d $DB -v ON_ERROR_STOP=1 -c "select pg_advisory_lock_shared(7777001)" -c "select pg_advisory_unlock_shared(7777001)" -c "set role authenticated" -c "select set_config('request.jwt.claims','{\"sub\":\"$uid\"}', false)" -c "$2" 2>&1)
  if echo "$o" | grep -q 'ERROR:'; then echo "$o" | grep -m1 'ERROR:' | sed 's/^.*ERROR:  /ERR:/'; else echo "$o" | tail -1; fi
}
psql -X -q -d $DB <<SQL
insert into auth.users (id, email, raw_user_meta_data) select ('${U}' || lpad(g::text,3,'0'))::uuid, 'u'||g||'@t', '{}' from generate_series(1,12) g on conflict do nothing;
insert into public.user_roles (user_id, role) select ('${U}' || lpad(g::text,3,'0'))::uuid, 'salon' from generate_series(2,12) g on conflict do nothing;
insert into public.platform_admins (user_id) values ('${U}001') on conflict do nothing;
insert into public.salon_organizations (id, name) values ('$A','CC社') on conflict do nothing;
insert into public.salon_stores (id, organization_id, store_name) values ('$A1','$A','CC1') on conflict do nothing;
insert into public.organization_members (organization_id, user_id, role) values ('$A','${U}003','company_admin'),('$A','${U}004','company_admin'),('$A','${U}008','company_admin'),('$A','${U}009','company_admin'),('$A','${U}010','company_admin'),('$A','${U}011','company_admin'),('$A','${U}012','company_admin') on conflict do nothing;
insert into public.store_members (store_id, user_id, role) values ('$A1','${U}006','store_manager'),('$A1','${U}007','recruiter') on conflict do nothing;
SQL
for i in 1 2 3 4; do as 1 "select public.admin_create_thread(gen_random_uuid(),'salon',null,'$A',null,null,'CCスレッド$i','本文$i')" > $OUT/t$i.out; done
T=($(q "select id from public.admin_threads where subject like 'CCスレッド%' order by subject"))

gate 5
# C1: 同じ送信者が4スレッドへ40件を同時に送る → ちょうど30件だけ成功
for i in $(seq 1 40); do as 3 "select public.inbox_reply(gen_random_uuid(),'${T[$((i%4))]}','同時$i')" > $OUT/c1_$i.out & done; wait
s=$(cat $OUT/c1_*.out | grep -vc '^ERR'); e=$(cat $OUT/c1_*.out | grep -c 'too many replies')
m=$(q "select count(*) from public.admin_messages where author_user_id='${U}003' and kind='from_recipient'")
ok "C1 複数スレッドへの同時40件送信でも、送信者単位で30件を超えない（成功$s/拒否$e/保存$m）" $([ "$s" = 30 ] && [ "$e" = 10 ] && [ "$m" = 30 ] && echo 1 || echo 0)

gate 5
# C2: 同じ送信IDの連絡作成を12本同時 → スレッド1・メッセージ1・通知1、全員が同じIDを受け取る
RID=$(q "select gen_random_uuid()")
for i in $(seq 1 12); do as 1 "select public.admin_create_thread('$RID','salon',null,'$A','$A1',null,'CC再送','同じ本文')" > $OUT/c2_$i.out & done; wait
d=$(cat $OUT/c2_*.out | sort -u | wc -l); th=$(q "select count(*) from public.admin_threads where subject='CC再送'")
ms=$(q "select count(*) from public.admin_messages m join public.admin_threads t on t.id=m.thread_id where t.subject='CC再送'")
dl=$(q "select count(*) from public.admin_message_deliveries d join public.admin_messages m on m.id=d.message_id join public.admin_threads t on t.id=m.thread_id where t.subject='CC再送'")
ok "C2 同じ送信IDの連絡作成を12本同時に送っても、スレッド1・メッセージ1・通知1（戻り値の種類$d/スレッド$th/メッセージ$ms/通知$dl）" $([ "$d" = 1 ] && [ "$th" = 1 ] && [ "$ms" = 1 ] && [ "$dl" = 1 ] && echo 1 || echo 0)

gate 5
# C3: 同じ送信IDの返信を12本同時 → メッセージ1件
RID=$(q "select gen_random_uuid()")
for i in $(seq 1 12); do as 8 "select public.inbox_reply('$RID','${T[0]}','再送返信')" > $OUT/c3_$i.out & done; wait
d=$(cat $OUT/c3_*.out | sort -u | wc -l); n=$(q "select count(*) from public.admin_messages where request_id='$RID'")
ok "C3 同じ送信IDの返信を12本同時に送っても、メッセージ1件・同じID（種類$d/保存$n）" $([ "$d" = 1 ] && [ "$n" = 1 ] && echo 1 || echo 0)

gate 5
# C4: 同じ送信IDで内容が違う2種類を同時 → 保存されるのは1種類だけ。もう一方は不一致で拒否
RID=$(q "select gen_random_uuid()")
for i in $(seq 1 10); do if [ $((i%2)) = 0 ]; then B=甲; else B=乙; fi; as 9 "select public.inbox_reply('$RID','${T[1]}','$B')" > $OUT/c4_$i.out & done; wait
n=$(q "select count(*) from public.admin_messages where request_id='$RID'"); b=$(q "select count(distinct body) from public.admin_messages where request_id='$RID'"); mm=$(cat $OUT/c4_*.out | grep -c 'content mismatch')
ok "C4 同じ送信IDで内容違いを同時に送ると、1種類だけ保存され、他方は拒否（保存$n/内容の種類$b/拒否$mm）" $([ "$n" = 1 ] && [ "$b" = 1 ] && [ "$mm" = 5 ] && echo 1 || echo 0)

# C5: 同じスレッドへ 運営の追記・相手の返信・完了/再開 を同時に（5回繰り返し）→ デッドロックなし・件数が一致
TT=${T[2]}; dead=0; badcount=0
for round in 1 2 3 4 5; do
  gate 3
  rm -f $OUT/c5_*.out
  b1=$(q "select count(*) from public.admin_messages where thread_id='$TT'")
  for i in $(seq 1 8); do as 1 "select public.admin_post_message(gen_random_uuid(),'$TT','to_recipient','追記$round-$i')" > $OUT/c5_a$i.out & done
  for i in $(seq 1 8); do as $((10 + i % 2)) "select public.inbox_reply(gen_random_uuid(),'$TT','返信$round-$i')" > $OUT/c5_b$i.out & done
  for i in $(seq 1 8); do if [ $((i%2)) = 0 ]; then S=done; else S=waiting_recipient; fi; as 1 "select public.admin_set_thread_status('$TT','$S')" > $OUT/c5_c$i.out & done
  wait
  dead=$((dead + $(cat $OUT/c5_*.out | grep -ci 'deadlock')))
  okA=$(cat $OUT/c5_a*.out | grep -vc '^ERR'); okB=$(cat $OUT/c5_b*.out | grep -vc '^ERR')
  b2=$(q "select count(*) from public.admin_messages where thread_id='$TT'")
  [ $((b2 - b1)) = $((okA + okB)) ] || badcount=$((badcount+1))
  # 追記は常に成功し、返信は「完了」と競合したときだけ拒否される（thread is closed）。それ以外のエラーは無い
  other=$(cat $OUT/c5_b*.out | grep '^ERR' | grep -vc 'thread is closed\|too many replies'); [ "$other" = 0 ] || badcount=$((badcount+1))
done
dl=$(q "select count(*) from public.admin_messages m where m.thread_id='$TT' and m.kind='to_recipient' and not exists (select 1 from public.admin_message_deliveries d where d.message_id=m.id)")
dd=$(q "select count(*) from (select message_id from public.admin_message_deliveries group by message_id having count(*)>1) x")
st=$(q "select status from public.admin_threads where id='$TT'")
ok "C5 追記・返信・完了/再開の同時操作（5回×24本）でデッドロックなし・保存件数が成功数と一致・通知は1メッセージ1件（デッドロック$dead/不一致$badcount/通知なし$dl/通知重複$dd/最終状態$st）" $([ "$dead" = 0 ] && [ "$badcount" = 0 ] && [ "$dl" = 0 ] && [ "$dd" = 0 ] && echo 1 || echo 0)

# C6: 複数スレッドを逆順に操作する運営の同時追記でもデッドロックしない
dead=0
for round in 1 2 3; do
  gate 3
  rm -f $OUT/c6_*.out
  for i in $(seq 1 6); do
    as 1 "select public.admin_post_message(gen_random_uuid(),'${T[0]}','internal_note','a$round$i')" > $OUT/c6_a$i.out &
    as 1 "select public.admin_post_message(gen_random_uuid(),'${T[1]}','internal_note','b$round$i')" > $OUT/c6_b$i.out &
    as 3 "select public.inbox_reply(gen_random_uuid(),'${T[1]}','c$round$i')" > $OUT/c6_c$i.out &
    as 12 "select public.inbox_reply(gen_random_uuid(),'${T[0]}','d$round$i')" > $OUT/c6_d$i.out &
  done; wait
  dead=$((dead + $(cat $OUT/c6_*.out | grep -ci 'deadlock')))
done
ok "C6 複数スレッドと複数の送信者が入り乱れる同時操作でデッドロックなし（$dead）" $([ "$dead" = 0 ] && echo 1 || echo 0)
echo "結果: PASS $pass / FAIL $fail"
