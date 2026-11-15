-- 追加の5問の保存記録の確認（本番用・読み取り専用。何も変更しません）。Supabase SQLエディタでそのまま実行できます。
-- 出力は件数・日時・判定だけです。回答の内容、利用者ID・店舗ID・名前・メールは出しません。
-- 目的: 「追加の5問を保存したのに画面が変わらない」操作が、(A)新経路で保存されたのか、(B)旧経路/別の版で保存されたのか、(C)保存されていないのかを切り分ける。
-- 結果は no / item / value の表。判定は 40 番台（人が読むための目安）。診断結果・回数・ロック日時は参照だけです。
select no, item, value from (
  with
  ana as (select salon_user_id, store_id,
                 case when store_id is null then 'salon_culture_user' else 'salon_culture_store' end as kind,
                 coalesce(salon_user_id, store_id) as owner, updated_at
            from public.salon_culture_analysis_answers where analysis_version = 'salon-analysis-v1'),
  req as (select kind, coalesce(user_id, store_id) as owner, created_at, result_ref, action
            from public.diagnosis_save_requests where kind in ('salon_culture_user','salon_culture_store')),
  per_ana as (
    select a.kind, a.owner, a.updated_at,
           (select count(*) from req r where r.kind = a.kind and r.owner = a.owner and r.result_ref is not null) as n_new,
           (select max(r.created_at) from req r where r.kind = a.kind and r.owner = a.owner and r.result_ref is not null) as last_new
      from ana a),
  drafts as (select (salon_user_id is null) as is_store, (payload -> 'extra') is not null and jsonb_typeof(payload -> 'extra') = 'object' as has_extra, updated_at
               from public.salon_culture_drafts)
  -- 1. 追加5問の保存済み状態
  select 10 as no, '追加5問の保存済み（本人）件数'::text as item, count(*)::text as value from ana where store_id is null
  union all select 11, '追加5問の保存済み（店舗）件数', count(*)::text from ana where store_id is not null
  union all select 12, '追加5問の最新の保存日時（日本時間）', coalesce(to_char(max(updated_at) at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI:SS'), '-') from ana
  union all select 13, '直近24時間に更新された追加5問の件数', count(*)::text from ana where updated_at > now() - interval '24 hours'
  -- 2. 新経路（下書き→確定）の確定記録
  union all select 20, '新経路の確定記録（本人・result_refあり）件数', count(*)::text from req where kind = 'salon_culture_user' and result_ref is not null
  union all select 21, '新経路の確定記録（店舗・result_refあり）件数', count(*)::text from req where kind = 'salon_culture_store' and result_ref is not null
  union all select 22, '新経路の確定記録の内訳（initial/change/unchanged/extra_completion）',
         coalesce(string_agg(action || '=' || n, ' / ' order by action), '-') from (select action, count(*) n from req where result_ref is not null group by action) t
  union all select 23, '新経路の最新の確定日時（日本時間）', coalesce(to_char(max(created_at) at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI:SS'), '-') from req where result_ref is not null
  union all select 24, 'result_refなし（旧経路・トリガー記録）のサロン記録の件数', count(*)::text from req where result_ref is null
  -- 3. 下書きの残存
  union all select 30, '下書きの残存（本人）件数 / うち追加5問を含む', count(*) filter (where not is_store) || ' / ' || count(*) filter (where not is_store and has_extra) from drafts
  union all select 31, '下書きの残存（店舗）件数 / うち追加5問を含む', count(*) filter (where is_store) || ' / ' || count(*) filter (where is_store and has_extra) from drafts
  union all select 32, '下書きの最古の更新日時（日本時間）', coalesce(to_char(min(updated_at) at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI:SS'), '-') from drafts
  -- 4. 保存済みの追加5問と、新経路の確定記録の突き合わせ（所有者ごと。IDは出さない）
  union all select 40, '追加5問が保存済みで、同じ所有者の新経路の確定記録が1件もない件数（旧経路・別の版で保存された疑い）', count(*)::text from per_ana where n_new = 0
  union all select 41, '追加5問の保存が、新経路の最新の確定より5秒以上あとの件数（確定を通らない更新の疑い）', count(*)::text from per_ana where last_new is not null and updated_at > last_new + interval '5 seconds'
  union all select 42, '追加5問が保存済みで、新経路の確定記録もある件数（新経路で保存された）', count(*)::text from per_ana where n_new > 0 and (last_new is null or updated_at <= last_new + interval '5 seconds')
) x
order by no;

-- 読み方（目安）:
--  ・行20/21が1件以上 かつ 行42が1件以上 … 新経路で保存された記録がある（適用前チェックの行8に使える）。画面表示だけの問題。
--  ・行10/11が1件以上 かつ 行40が同じ件数 かつ 行20/21が0 … 追加5問は保存されたが新経路を通っていない。配備されている版が旧経路のまま、の疑い。
--  ・行10/11が0 かつ 行30/31に追加5問を含む下書きがある … 下書き保存までで確定されていない（確定の失敗）。
--  ・行10/11が0 かつ 下書きも0 … 保存操作がサーバーまで届いていない（画面側で止まっている）。
