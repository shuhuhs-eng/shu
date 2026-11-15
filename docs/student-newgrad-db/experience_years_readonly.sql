-- 経験年数の現状確認（本番用・読み取り専用。何も変更しません）。件数だけを出し、個人を特定できる値は出しません。
-- 目的: 「未登録(NULL)」「0年」「1年以上」の分布を知る。既存会員の値は推測で変更しない（このSQLは参照のみ）。
select no, item, value from (
  select 1 as no, '美容師プロフィールの総数'::text as item, count(*)::text as value from public.stylist_profiles
  union all select 2, '経験年数が未登録（NULL）', count(*) filter (where experience_years is null)::text from public.stylist_profiles
  union all select 3, '経験年数が0年', count(*) filter (where experience_years = 0)::text from public.stylist_profiles
  union all select 4, '経験年数が1年以上', count(*) filter (where experience_years >= 1)::text from public.stylist_profiles
  union all select 5, '0年のうち、学生・新卒の区分を選んだ人（0071適用後のみ。適用前は0）',
         case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='stylist_profiles' and column_name='career_phase')
              then (select count(*) from public.stylist_profiles where experience_years = 0 and (to_jsonb(stylist_profiles) ->> 'career_phase') in ('student','new_graduate'))::text else '0' end
  union all select 6, '経験年数の最大値（範囲0〜60に収まっているか）', coalesce(max(experience_years)::text, '-') from public.stylist_profiles
) x order by no;
