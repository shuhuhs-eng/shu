-- ============================================================================
-- Beauty Reach — 0034_store_scout_rpc
--
-- 法人・複数店舗対応 Phase 4 Step 4。Scout送信をstore単位・organization
-- quota単位で行う新RPC send_scout_v2() を追加する。
--
-- ★既存send_scout()は一切変更しない（create or replaceしない。ファイル
-- 自体も編集しない）。既存/salon/stylists・既存salon_scout_quotasは
-- 今までどおり動作する。send_scout_v2はまだどのUI/Server Actionからも
-- 呼ばれない（本migrationの時点では純粋な並走基盤）。
--
-- ★既存send_scout()（0025定義、以後再定義なしを確認済み）の仕様を以下の
-- 通り把握した上で、store対応に必要な差分以外は完全に維持している:
--   引数: (p_stylist_user_id uuid, p_message text, p_template_type text
--     default null) / 戻り値: public.scouts
--   caller guard: auth.uid() not null → caller role='salon'
--   target guard: target role='stylist' → stylist_profiles.visibility=
--     'PUBLIC' → user_settings.scout_enabled=false なら例外(opt-out)
--   message: trim+coalesce後null不可・1000文字超は例外
--   template_type: null許容、非nullなら'casual'/'concrete'のみ
--   quota: salon_scout_quotas(salon_user_id)をinsert...on conflict do
--     nothingで初期化→select...for updateでロック→当月(date_trunc('month',
--     now())以降)のscouts件数をcount→v_used >= (monthly_free_limit +
--     additional_credits)なら例外（無料枠と追加クレジットを単純合算した
--     1つの総枠として判定。additional_creditsだけを個別に減算する処理は
--     元から存在しない）
--   matching_score: calculate_match_axes(p_stylist_user_id, v_salon_uid)
--     を呼び、available=trueのときのみround(overall_score)を整数で保存、
--     available=falseのときはNULL（0点に変換しない）
--   再Scout: unique制約なし、常に新規insert（禁止ロジックなし）
--   scouts INSERT: (salon_user_id, stylist_user_id, message,
--     template_type, matching_score)の5列のみ明示。read_status/
--     response_status/sent_at/created_atはテーブルのdefault値に委ねる
--   revoke/grant: revoke all ... from public, anon; grant execute ...
--     to authenticated
--
-- ★既存migration(0001〜0033)は一切編集していない。
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- send_scout_v2(): store単位Scout送信。
--
-- actor / store / targetの分離（最重要）:
--   actor  = auth.uid()（実際にこのRPCを呼んだ担当者）
--   store  = p_store_id（採用活動の主体。is_store_accessible()でのみ
--            アクセス権を判定し、auth.uid()とstore_idを同一視しない）
--   target = p_stylist_user_id（スカウト対象の美容師）
--
-- organization_idはp_store_idから取得したsalon_stores.organization_idの
-- みを正とする（auth.uid()・salon_onboarding_assignments等から推測しない。
-- is_store_accessible()が与えてくれるのは「このstore_idを操作できるか」
-- だけであり、どのorganizationに属すかは必ずsalon_stores自体から読む）。
-- ----------------------------------------------------------------------------
create or replace function public.send_scout_v2(
  p_store_id uuid,
  p_stylist_user_id uuid,
  p_message text,
  p_template_type text default null
) returns public.scouts
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_organization_id uuid;
  v_message text := nullif(trim(coalesce(p_message, '')), '');
  v_limit integer;
  v_credits integer;
  v_used integer;
  v_match jsonb;
  v_score integer;
  v_row public.scouts;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.user_roles where user_id = v_uid and role = 'salon') then
    raise exception 'caller is not a salon';
  end if;

  -- ★店舗アクセス権は必ずis_store_accessible()で判定する（0026のRLSが使う
  -- 関数そのもの。auth.uid() = store所有者、という誤った判定は行わない）。
  if not public.is_store_accessible(p_store_id) then
    raise exception 'store not found or not accessible';
  end if;

  -- is_store_accessible()がtrueを返した時点でp_store_idは実在するため、
  -- organization_idは必ず取得できる。
  select organization_id into v_organization_id
  from public.salon_stores where id = p_store_id;

  -- ★以下、既存send_scout()と完全に同一の対象美容師条件・入力検証
  -- （店舗単位対応による変更はしない）。
  if not exists (select 1 from public.user_roles where user_id = p_stylist_user_id and role = 'stylist') then
    raise exception 'target is not a stylist';
  end if;
  if not exists (select 1 from public.stylist_profiles where user_id = p_stylist_user_id and visibility = 'PUBLIC') then
    raise exception 'target stylist is not public';
  end if;
  if exists (select 1 from public.user_settings where user_id = p_stylist_user_id and scout_enabled = false) then
    raise exception 'target stylist has scouting disabled';
  end if;

  if v_message is null then raise exception 'message required'; end if;
  if char_length(v_message) > 1000 then raise exception 'message too long'; end if;
  if p_template_type is not null and p_template_type not in ('casual','concrete') then
    raise exception 'invalid template type';
  end if;

  -- ★quotaの契約主体はorganization。既存send_scout()と同じ
  -- 「insert...on conflict do nothingで初期化→for updateでロック」パターン
  -- をorganization_scout_quotasに適用する。同一organization内の複数店舗・
  -- 複数担当者が同時に送信しても、このロックにより直列化される（既存
  -- send_scout()のTOCTOU対策と同一の設計、ロック対象がsalon_user_id単位
  -- からorganization_id単位に変わるだけ）。
  insert into public.organization_scout_quotas (organization_id) values (v_organization_id)
  on conflict (organization_id) do nothing;

  select monthly_free_limit, additional_credits into v_limit, v_credits
  from public.organization_scout_quotas where organization_id = v_organization_id
  for update;

  -- ★月次使用数（重要・意図的な制限事項）: この会社が保有する全店舗
  -- （salon_stores.organization_id = v_organization_id）のうち、
  -- scouts.store_idが設定されている（=send_scout_v2経由で送信された）
  -- Scoutのみを当月使用数として数える。
  --
  -- 旧send_scout()経由のScout（store_id is null）は、0034時点では
  -- この集計に一切含めない。理由:
  --   ・二重カウント防止: 旧Scoutは旧salon_scout_quotas側で既に
  --     カウント対象になっているため、新organization quota側でも
  --     数えると同じ送信が2つのquotaから二重に消費されることになる。
  --   ・誤帰属防止: store_id=nullのScoutを
  --     「salon_onboarding_assignments経由で推測したstore」に勝手に
  --     帰属させることは、ユーザー指示により明示的に禁止されている
  --     （mappingが曖昧な行を推測で寄せない）。
  --
  -- ★既知のリスク（Phase 4 UI切替時に必ず対応が必要）: 0034時点では
  -- send_scout_v2はまだUIから呼ばれないため実害は無いが、将来UIが
  -- send_scout_v2を呼び始めた後も旧/salon/stylists（旧send_scout()）が
  -- 並走する期間がある場合、同じ会社が新旧両方のquotaをそれぞれ別枠
  -- として使える状態になり、実質的に合計の送信可能数が増えてしまう
  -- （quotaの抜け道）。この抜け道は0034では解消しない。UI切替時の対応策
  -- として、以下いずれかを選択する必要がある:
  --   (a) UI切替と同時に旧send_scout()の呼び出しを完全に停止する
  --       （旧ルート自体を閉じる。最も安全）。
  --   (b) 旧ルートを一定期間並走させる場合、送信前チェックの時点で
  --       旧salon_scout_quotasの残枠も合わせて消費済みとみなす統合判定
  --       ロジックを別migrationで追加する。
  -- いずれも0034の範囲外であり、今回は実装しない。
  select count(*) into v_used
  from public.scouts s
  join public.salon_stores ss on ss.id = s.store_id
  where ss.organization_id = v_organization_id
    and s.sent_at >= date_trunc('month', now());

  if v_used >= (v_limit + v_credits) then
    raise exception 'monthly scout limit reached';
  end if;

  -- ★matching_scoreはstoreのcultureを基準に算出する（0031の
  -- calculate_match_axes_by_store()。既存calculate_match_axesは使わない）。
  -- available=falseの場合はNULLのまま保存する（既存send_scout()と同じ
  -- 挙動。0点へ変換しない）。
  v_match := public.calculate_match_axes_by_store(p_stylist_user_id, p_store_id);
  v_score := case when (v_match->>'available')::boolean then (v_match->>'overall_score')::numeric::integer else null end;

  -- ★scouts INSERT: salon_user_id（旧互換列）・created_by_user_id（実際の
  -- 操作者）・store_id（採用活動主体）の3つを混同しない。
  --   salon_user_id      = v_uid（旧互換のため、NULLにしない）
  --   created_by_user_id = v_uid（実際にこのRPCを呼んだ担当者）
  --   store_id           = p_store_id（採用活動の主体）
  -- message/template_type/matching_scoreは既存send_scout()と同じ列。
  -- read_status/response_status/sent_at/created_atはテーブルのdefault値
  -- に委ねる（既存send_scout()と同一の挙動）。再Scout禁止のunique制約は
  -- 追加していない（既存仕様どおり、何度でも新しい履行行を作れる）。
  insert into public.scouts (
    salon_user_id, stylist_user_id, message, template_type, matching_score,
    store_id, created_by_user_id
  ) values (
    v_uid, p_stylist_user_id, v_message, p_template_type, v_score,
    p_store_id, v_uid
  )
  returning * into v_row;

  return v_row;
end;
$$;
comment on function public.send_scout_v2 is '店舗単位Scout送信（法人・複数店舗対応 Phase 4）。actor(auth.uid())/store(p_store_id、is_store_accessible()でのみアクセス判定)/target(p_stylist_user_id)を分離する。quotaはorganization_scout_quotas（会社単位、FOR UPDATEで直列化）を使用し、既存salon_scout_quotasには一切触れない。matching_scoreはcalculate_match_axes_by_store()でstore culture基準に算出。対象美容師の条件・message/template_type検証・再Scout許可・quota判定ロジックは既存send_scout()(0025)と同一。月次使用数はstore_idが設定されたScoutのみを数え、旧send_scout()経由（store_id is null）のScoutは二重カウント防止のため対象外（UI切替時に別途対応が必要、コメント参照）。既存send_scout()は無変更。';

revoke all on function public.send_scout_v2(uuid, uuid, text, text) from public, anon;
grant execute on function public.send_scout_v2(uuid, uuid, text, text) to authenticated;

commit;
