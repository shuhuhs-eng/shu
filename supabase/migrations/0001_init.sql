-- ============================================================================
-- Beauty Reach — 0001_init
-- profiles / stylist_private / stylist_profiles / salon_profiles /
-- employee_size_master / user_settings / pending_diagnoses / diagnosis_results /
-- diagnosis_ai_outputs ＋ RLS ＋ handle_new_user トリガー
--
-- 方針:
--  * 個人情報(氏名/年代/性別)は stylist_private に隔離し、本人のみアクセス可。
--    salon側はサロン(法人・屋号)が主体のため、現時点では個人情報テーブル
--    (salon_private相当)は作らない。
--  * 表示用の名前は stylist_profiles.public_name / salon_profiles.salon_name に持つ。
--    profiles テーブルにはアカウント基盤の情報のみを置き、表示名は持たない。
--  * stylist_profiles / stylist_private / salon_profiles は handle_new_user()
--    トリガーでは作成しない。save_stylist_profile() / save_salon_profile() の
--    upsert(INSERT ... ON CONFLICT DO UPDATE)に一本化し、登録だけして
--    オンボーディングを完了しなかったユーザーの空プロフィール行を作らない。
--  * オンボーディングの進捗は真偽値ではなく onboarding_step(int) で管理し、
--    複数ステップ化に対応できるようにする。
--  * 診断結果はイミュータブル。stylist/salon共通の diagnosis_results テーブルを使う
--    （mode列で判別）。AI生成物(解説・アドバイス)は diagnosis_ai_outputs に分離し、
--    診断結果本体（回答・スコア・タイプ・市場価値）とは独立して扱う。
--  * pending_diagnoses は RLS 有効・ポリシー無し＝匿名/認証ユーザーは直接触れない。
--    未ログイン診断の一時保存とクレームはサーバー側 service role 経由でのみ行う。
--    pending_diagnoses にはスコア・タイプ・市場価値を保存しない（回答から再計算）。
--  * stylist_profiles.visibility / salon_profiles.visibility はプロフィールの
--    公開範囲(PRIVATE/LIMITED/PUBLIC)。現時点ではデータ列のみ用意し、
--    閲覧制御自体は次フェーズ以降で実装する。
--  * employee_size_band は enum ではなく employee_size_master 参照とし、
--    文言変更・区分追加をマイグレーション無しで行えるようにする。
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------- enums ----------------------------------------------------------
create type public.user_role         as enum ('stylist', 'salon', 'admin');
create type public.gender_type       as enum ('male', 'female', 'other', 'prefer_not_to_say');
create type public.age_band          as enum ('under_20','20_24','25_29','30_34','35_39','40_44','45_plus','prefer_not_to_say');
create type public.employment_type   as enum ('full_time','part_time','contract','freelance','owner','other');
create type public.job_change_intent as enum ('active','passive','not_looking');
-- 希望年収帯（万円/年）: lt_350=350未満, gt_800=800超, flexible=応相談
create type public.salary_band       as enum ('lt_350','350_450','450_600','600_800','gt_800','flexible');
create type public.diagnosis_mode    as enum ('stylist','salon');
-- プロフィールの公開範囲: PRIVATE=非公開 / LIMITED=一部公開(将来のスカウト機能等) / PUBLIC=公開
create type public.profile_visibility as enum ('PRIVATE', 'LIMITED', 'PUBLIC');
-- AI生成物の種別。診断結果ごとに種別ごと複数バージョンを保持できる。
create type public.ai_output_type as enum ('essence', 'explanation', 'advice', 'growth');
-- pending_diagnoses のクレーム進行状態。COMPLETEDは diagnosis_results 保存後にのみ設定される
-- （start_pending_diagnosis_claim→diagnosis_results保存→complete_pending_diagnosis_claimの順を構造的に強制するため）。
create type public.pending_diagnosis_claim_status as enum ('PENDING', 'PROCESSING', 'COMPLETED');
-- diagnosis_results のAI解説生成状態。生成は非同期ジョブとして行うため状態を分けて持つ。
create type public.ai_generation_status as enum ('PENDING', 'GENERATING', 'READY', 'FAILED');

-- ---------- employee_size_master : 従業員数区分マスタ --------------------
-- enumではなくマスタテーブルにすることで、文言変更・区分追加をマイグレーション
-- 無しで行える（コードはcodeで固定し、labelだけ後から変更可能）。
create table public.employee_size_master (
  code       text primary key,        -- 例: '1_5' '6_15' '16_30' '31_plus'（安定した識別子。変更しない）
  label      text not null,           -- 表示用ラベル（日本語）。運用中に変更可能。
  sort_order integer not null,        -- 表示順
  is_active  boolean not null default true -- falseにすると新規選択肢からは除外（既存参照は維持）
);
comment on table public.employee_size_master is '従業員数区分のマスタ。salon_profiles.employee_size_codeから参照される。区分の追加・文言変更はこのテーブルへのINSERT/UPDATEで行い、マイグレーション不要。';
insert into public.employee_size_master (code, label, sort_order) values
  ('1_5',    '1〜5名',   1),
  ('6_15',   '6〜15名',  2),
  ('16_30',  '16〜30名', 3),
  ('31_plus','31名以上', 4);

alter table public.employee_size_master enable row level security;
create policy employee_size_master_select_active on public.employee_size_master
  for select using (is_active);
grant select on public.employee_size_master to authenticated;

-- ---------- updated_at 共通トリガー ----------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------- profiles : アカウント基盤（auth.users と 1:1） ------------------
-- 表示名(public_name)は持たない（stylist_profiles.public_name を参照）。
create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  role             public.user_role not null default 'stylist',
  avatar_path      text,  -- avatarsバケット内のオブジェクトパス。外部URLではなく内部パスのみ保持する。
  onboarding_step  integer not null default 0 check (onboarding_step between 0 and 4),
  profile_version  integer not null default 1,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.profiles is 'アカウント基盤。auth.users と 1:1。表示名は持たない（stylist_profiles.public_name を参照）。';
comment on column public.profiles.avatar_path is 'avatarsバケット(非公開)内のオブジェクトパス（"{auth.uid()}/avatar.webp"固定）。表示時はサーバー側で署名付きURLを都度発行する。';
comment on column public.profiles.onboarding_step is 'オンボーディング進捗。0=ACCOUNT_CREATED / 1=PROFILE_COMPLETED / 2=DIAGNOSIS_CLAIMED(任意) / 3=SETTINGS_COMPLETED / 4=COMPLETE。定数は lib/auth/onboarding.ts で管理。完了判定は isOnboardingComplete()（=COMPLETE到達）を使用し、DIAGNOSIS_CLAIMEDは完了の必須条件ではない。';
comment on column public.profiles.profile_version is 'save_stylist_profile() が成功するたびに+1される版数。楽観的な変更検知・キャッシュ無効化等に利用可能。';

-- ---------- stylist_private : 個人情報(PII)。本人のみ ----------------------
create table public.stylist_private (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  full_name  text check (full_name is null or char_length(full_name) <= 60),
  age_band   public.age_band,
  gender     public.gender_type,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.stylist_private is '個人情報(氏名/年代/性別)。サロンへ自動公開しない。本人のみ。メールは auth.users 管理。';

-- ---------- stylist_profiles : 職務情報・公開プロフィール（将来サロンへ準公開） --
create table public.stylist_profiles (
  user_id              uuid primary key references public.profiles(id) on delete cascade,
  public_name          text check (public_name is null or char_length(public_name) <= 40),
  visibility           public.profile_visibility not null default 'PRIVATE',
  prefecture           text,
  desired_work_location text,
  experience_years     integer check (experience_years is null or (experience_years between 0 and 60)),
  current_position     text,
  specialties          text[] not null default '{}',
  employment_type      public.employment_type,
  job_change_intent    public.job_change_intent not null default 'passive',
  desired_salary_range public.salary_band,
  instagram_handle     text check (instagram_handle is null or char_length(instagram_handle) <= 40),
  bio                  text check (bio is null or char_length(bio) <= 1000),
  sns_links            jsonb not null default '[]'::jsonb,
  value_priorities     text[] check (value_priorities is null or array_length(value_priorities, 1) = 3),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.stylist_profiles is '美容師の公開プロフィール・職務情報。public_name が表示名。visibility で公開範囲を制御（将来のサロン閲覧機能で使用）。';
comment on column public.stylist_profiles.public_name is 'サロン等に表示される公開用の名前。profiles テーブルには表示名を持たない。';
comment on column public.stylist_profiles.visibility is 'プロフィールの公開範囲。PRIVATE=非公開 / LIMITED=一部公開 / PUBLIC=公開。閲覧制御自体は次フェーズ以降で実装。';
comment on column public.stylist_profiles.instagram_handle is '非推奨（sns_linksへ統合済み）。後方互換のため列自体は残すが、save_stylist_profile()は以後この列を書き込まない。';
comment on column public.stylist_profiles.sns_links is 'SNSアカウントのリンク集。[{"platform":"instagram","handle":"..."}] の形式のjsonb配列。プラットフォームを追加してもマイグレーション不要な拡張可能設計。現在UIで収集するのはInstagramのみ。';
comment on column public.stylist_profiles.value_priorities is '働き方・価値観の優先順位（候補約12項目から重要な3つを順位付きで選択）。配列の順序が優先順位を表す(0番目=第1優先)。3件ちょうどでなければ拒否する（部分入力は許可しない）。AIマッチング精度向上のためのシグナルとして利用する想定（Phase 5以降）。';

-- ---------- salon_profiles : サロンの公開プロフィール（stylist_profilesに対称）--
-- サロンは法人・屋号が主体のため、stylist_privateに相当する個人情報テーブルは
-- 現時点では作らない（将来「担当者名」等が必要になった場合に追加する）。
-- prefecture/city/street_addressに分けているのは、将来「都道府県までは公開・
-- 番地は非公開」のように公開範囲を列単位で柔軟に制御できるようにするため
-- （現時点では列単位のRLSは実装せず、visibility一本で制御する）。
create table public.salon_profiles (
  user_id              uuid primary key references public.profiles(id) on delete cascade,
  salon_name           text check (salon_name is null or char_length(salon_name) <= 60),
  visibility           public.profile_visibility not null default 'PRIVATE',
  prefecture           text,
  city                 text,
  street_address       text,
  culture_description  text check (culture_description is null or char_length(culture_description) <= 2000),
  employee_size_code   text references public.employee_size_master(code),
  target_specialties   text[] not null default '{}',
  instagram_handle     text check (instagram_handle is null or char_length(instagram_handle) <= 40),
  bio                  text check (bio is null or char_length(bio) <= 1000),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.salon_profiles is 'サロンの公開プロフィール。salon_nameが表示名。stylist_profilesと対称構造。visibilityで公開範囲を制御（将来の閲覧機能で使用）。書き込みはsave_salon_profile()経由のみ（handle_new_user()では作成しない）。';
comment on column public.salon_profiles.salon_name is 'サロンの公開名（屋号）。stylist_profiles.public_nameに相当。';
comment on column public.salon_profiles.employee_size_code is 'employee_size_masterを参照する従業員数区分。enumではなくマスタテーブル参照とし、区分追加・文言変更にマイグレーション無しで対応できるようにしている。';

-- ---------- user_settings : 設定（スカウト受信等）--------------------------
create table public.user_settings (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  scout_enabled boolean not null default true,
  scout_prefs   jsonb not null default '{}'::jsonb,
  notify_email  boolean not null default true,
  line_linked   boolean not null default false,   -- LINE連携は将来Phase
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.user_settings is 'ユーザー設定。スカウト受信可否・通知設定など。';

-- ---------- pending_diagnoses : 未ログイン診断の一時保存 -------------------
-- 保存するのは「回答・version・作成/有効期限・claim_token・claim情報」のみ。
-- スコア/タイプ/市場価値は保存せず、確定時にサーバーで回答から再計算する。
create table public.pending_diagnoses (
  id                uuid primary key default gen_random_uuid(),
  claim_token       uuid not null unique default gen_random_uuid(),
  mode              public.diagnosis_mode not null default 'stylist', -- 再計算に必要な質問バンク種別
  answers           jsonb not null,
  diagnosis_version text not null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default (now() + interval '30 days'),
  claim_status      public.pending_diagnosis_claim_status not null default 'PENDING',
  claimed_by        uuid references public.profiles(id) on delete set null,
  claimed_at        timestamptz
);
comment on table public.pending_diagnoses is '未ログイン診断の一時保存。RLSポリシー無し＝直接アクセス不可。サーバーの service role 経由でのみ操作。';
comment on column public.pending_diagnoses.claim_status is 'PENDING=未クレーム / PROCESSING=クレーム中(diagnosis_results保存待ち) / COMPLETED=diagnosis_results保存済み。COMPLETEDはcomplete_pending_diagnosis_claim()がdiagnosis_resultsの存在を確認した上でのみ設定する。';
create index pending_diagnoses_expires_idx   on public.pending_diagnoses (expires_at);
create index pending_diagnoses_claimed_idx   on public.pending_diagnoses (claimed_by);

-- 未ログイン診断結果のクレームを開始する（PENDING→PROCESSING）。
-- pending_diagnoses には SELECT/UPDATE いずれのRLSポリシーも無く直接アクセス不可のため、
-- 認証済みユーザーが自分の claim_token を消費できる唯一の経路がこの関数になる。
--   ・所有権は「claim_tokenを知っていること」そのもの（メール等で本人にのみ渡る想定）。
--   ・二重クレーム防止: claim_status = 'PENDING' かつ expires_at > now() の行だけを
--     対象にした条件付きUPDATEにより、同時に複数回呼ばれても最初の1回だけが成功する。
--   ・冪等な再試行: 直前の呼び出しで PROCESSING まで進んだが diagnosis_results の
--     保存が完了せず再試行された場合、同一ユーザーによる再開であれば
--     既存のPROCESSING行をそのまま返す（新たな二重クレームにはならない）。
--   ・スコア・タイプ・市場価値はここでは一切計算しない。呼び出し元(Next.jsサーバー)が
--     このRPCが返す answers を使って lib/diagnosis で再計算し、diagnosis_results へ
--     別途INSERTしてから complete_pending_diagnosis_claim() を呼ぶ想定。
--   ・claim_status='COMPLETED'は、diagnosis_resultsの保存が確認された後にのみ
--     complete_pending_diagnosis_claim() が設定する。このRPC単体では設定しない
--     ＝「クレーム済みだがdiagnosis_resultsが存在しない」状態を構造的に作れない。
--   ・search_path を固定し、SECURITY DEFINER に対する search_path 汚染攻撃を防ぐ。
create or replace function public.start_pending_diagnosis_claim(
  p_claim_token uuid
) returns public.pending_diagnoses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.pending_diagnoses;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.pending_diagnoses
    set claimed_by = v_uid,
        claimed_at = now(),
        claim_status = 'PROCESSING'
    where claim_token = p_claim_token
      and claim_status = 'PENDING'
      and expires_at > now()
    returning * into v_row;

  if found then
    return v_row;
  end if;

  -- 冪等性のためのフォールバック: 同一ユーザーによる PROCESSING 行の再開であれば許可する。
  select * into v_row
    from public.pending_diagnoses
    where claim_token = p_claim_token
      and claim_status = 'PROCESSING'
      and claimed_by = v_uid;

  if found then
    return v_row;
  end if;

  raise exception 'pending diagnosis not found, claimed by someone else, already completed, or expired';
end;
$$;
comment on function public.start_pending_diagnosis_claim is '未ログイン診断結果のクレームを開始する(PENDING→PROCESSING)唯一の経路。claim_status=PENDINGかつ期限内の行だけを対象にした条件付きUPDATEで二重クレームを防止するSECURITY DEFINER関数。同一ユーザーによる再試行はPROCESSING行をそのまま返す。';

-- diagnosis_results の保存が確認できた場合にのみ、クレームを完了させる（PROCESSING→COMPLETED）。
-- これにより「claim_status=COMPLETEDだがdiagnosis_resultsが存在しない」状態を構造的に排除する。
create or replace function public.complete_pending_diagnosis_claim(
  p_pending_id uuid
) returns public.pending_diagnoses
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.pending_diagnoses;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.diagnosis_results
    where source_pending_id = p_pending_id and user_id = v_uid
  ) then
    raise exception 'diagnosis_results not found for this pending diagnosis; cannot complete claim';
  end if;

  update public.pending_diagnoses
    set claim_status = 'COMPLETED'
    where id = p_pending_id
      and claimed_by = v_uid
      and claim_status = 'PROCESSING'
    returning * into v_row;

  if not found then
    raise exception 'pending diagnosis not found, not owned by caller, or not in PROCESSING state';
  end if;

  return v_row;
end;
$$;
comment on function public.complete_pending_diagnosis_claim is 'diagnosis_resultsの存在確認後にのみclaim_status=COMPLETEDへ進める唯一の経路。SECURITY DEFINER、固定search_path。';

-- 期限切れの pending_diagnoses を削除するメンテナンス関数。
-- クライアント（anon/authenticated）からは呼び出せない（後述のGRANTで一切付与しない）。
-- 呼び出しは以下いずれかの方法を想定する:
--   (a) pg_cron 拡張が利用可能な場合:
--       select cron.schedule('cleanup-pending-diagnoses', '0 3 * * *',
--         $$select public.cleanup_expired_pending_diagnoses()$$);
--       pg_cron のジョブは既定でDBオーナー権限で実行されるため、GRANT無しでも呼び出せる。
--   (b) pg_cron が使えない場合:
--       外部スケジューラ(Vercel Cron等)から /api/cron/cleanup-pending-diagnoses を
--       定期的に叩き、そのRoute Handlerが service role クライアントでこの関数を呼ぶ
--       （service role はGRANTを介さずアクセスできるため、これもGRANT不要で動作する）。
-- 削除対象は claim_status を問わず expires_at を過ぎた全行。COMPLETED後は
-- diagnosis_results 側に永続記録があるため、pending_diagnoses 側は削除して問題ない
-- （diagnosis_results.source_pending_id は on delete set null のため、
-- 削除してもdiagnosis_results自体は失われない）。
create or replace function public.cleanup_expired_pending_diagnoses()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  delete from public.pending_diagnoses
  where expires_at < now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
comment on function public.cleanup_expired_pending_diagnoses is '期限切れのpending_diagnosesを削除する。クライアントからは呼び出せない（pg_cronまたはservice role経由のみ）。戻り値は削除件数。';

-- ---------- diagnosis_results : 確定した診断結果（イミュータブル）----------
-- AI生成物(ai_essence等)はここに持たず、diagnosis_ai_outputs に分離する。
create table public.diagnosis_results (
  id                 uuid primary key default gen_random_uuid(),          -- diagnosis_id
  user_id            uuid not null references public.profiles(id) on delete cascade,
  diagnosis_version  text not null,
  mode               public.diagnosis_mode not null default 'stylist',
  answers            jsonb not null,                                      -- 回答データ（再計算用）
  craft_score        smallint not null check (craft_score       between 0 and 100),
  sense_score        smallint not null check (sense_score        between 0 and 100),
  hospitality_score  smallint not null check (hospitality_score  between 0 and 100),
  brand_score        smallint not null check (brand_score        between 0 and 100),
  drive_score        smallint not null check (drive_score        between 0 and 100),
  mentor_score       smallint not null check (mentor_score       between 0 and 100),
  type_id            text not null,
  type_name          text not null,
  market_value_score smallint check (market_value_score is null or (market_value_score between 0 and 100)),
  salary_band        text,
  source_pending_id  uuid unique references public.pending_diagnoses(id) on delete set null, -- 引き継ぎ重複防止
  ai_status          public.ai_generation_status not null default 'PENDING', -- AI解説は非同期ジョブで生成
  created_at         timestamptz not null default now()                   -- 診断日時
);
comment on table public.diagnosis_results is '確定した診断結果（回答・スコア・タイプ・市場価値のみ）。回答とversionを保持し再計算可能。AI生成物は diagnosis_ai_outputs を参照。ai_status以外は更新不可＝イミュータブル。';
comment on column public.diagnosis_results.ai_status is 'AI解説の生成状態。PENDING=未着手 / GENERATING=生成中 / READY=生成完了 / FAILED=生成失敗。set_diagnosis_ai_status() RPC経由でのみ変更可能。';
create index diagnosis_results_user_created_idx on public.diagnosis_results (user_id, created_at desc);

-- ---------- diagnosis_ai_outputs : AI生成物（診断結果から分離）-------------
-- 1つの diagnosis_result_id につき、output_type ごとに複数バージョンを保存できる
-- （regenerateのたびに新しい行を追加し、履歴を残す）。
-- 「同一(diagnosis_result_id, output_type)の中で is_current=true は最大1件」は
-- 部分ユニークインデックスでDBレベルに保証する。作成は create_ai_output()、
-- current の付け替えは activate_ai_output() の2つのRPCに分離して行う想定
-- （UPDATEで変更してよいのは is_current のみで、他の列は不変トリガーで保護する）。
create table public.diagnosis_ai_outputs (
  id                  uuid primary key default gen_random_uuid(),
  diagnosis_result_id uuid not null references public.diagnosis_results(id) on delete cascade,
  output_type         public.ai_output_type not null,
  provider            text not null,               -- 例: 'anthropic'
  model               text not null,                -- 例: 'claude-sonnet-4-6'
  prompt_version      text not null,                -- プロンプトテンプレートのバージョン
  response            jsonb not null,                -- 生成結果本体
  is_current          boolean not null default true, -- 同一(diagnosis_result_id, output_type)内の最新版フラグ
  created_at          timestamptz not null default now()
);
comment on table public.diagnosis_ai_outputs is 'AI生成物。診断結果1件・用途(output_type)ごとに複数バージョンを保持可能。is_currentで現行版を示す（部分ユニークインデックスで一意性を保証）。';
create index diagnosis_ai_outputs_result_idx on public.diagnosis_ai_outputs (diagnosis_result_id);

-- 同一(diagnosis_result_id, output_type)で is_current=true は最大1件のみ許可。
create unique index diagnosis_ai_outputs_current_uniq
  on public.diagnosis_ai_outputs (diagnosis_result_id, output_type)
  where is_current;

-- is_current 以外の列は作成後に変更不可（履歴改ざん防止）。
create or replace function public.enforce_ai_output_immutable_fields()
returns trigger language plpgsql as $$
begin
  if new.id is distinct from old.id
     or new.diagnosis_result_id is distinct from old.diagnosis_result_id
     or new.output_type is distinct from old.output_type
     or new.provider is distinct from old.provider
     or new.model is distinct from old.model
     or new.prompt_version is distinct from old.prompt_version
     or new.response is distinct from old.response
     or new.created_at is distinct from old.created_at then
    raise exception 'diagnosis_ai_outputs: is_current 以外の列は更新できません';
  end if;
  return new;
end;
$$;
create trigger trg_ai_outputs_immutable
  before update on public.diagnosis_ai_outputs
  for each row execute function public.enforce_ai_output_immutable_fields();

-- AI生成結果の新規作成（is_current=falseで登録するだけ。current切替はactivate_ai_output()）。
--   ・所有権確認: 対象 diagnosis_results が auth.uid() のものであることを確認。
--   ・current切替を伴わないため行ロックは不要（一意性制約に触れない）。
--   ・search_path を固定し、SECURITY DEFINER に対する search_path 汚染攻撃を防ぐ。
create or replace function public.create_ai_output(
  p_diagnosis_result_id uuid,
  p_output_type public.ai_output_type,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_response jsonb
) returns public.diagnosis_ai_outputs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.diagnosis_ai_outputs;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  if not exists (
    select 1 from public.diagnosis_results
    where id = p_diagnosis_result_id and user_id = v_uid
  ) then
    raise exception 'diagnosis_result not found or not owned by caller';
  end if;

  insert into public.diagnosis_ai_outputs
    (diagnosis_result_id, output_type, provider, model, prompt_version, response, is_current)
  values
    (p_diagnosis_result_id, p_output_type, p_provider, p_model, p_prompt_version, p_response, false)
  returning * into v_row;

  return v_row;
end;
$$;
comment on function public.create_ai_output is 'AI生成物を is_current=false で新規登録する（現行版への昇格はactivate_ai_output()で行う）。SECURITY DEFINER、固定search_path。';

-- 既存のAI生成結果を「現行版」として原子的に有効化するRPC。
-- クライアントからの直接UPDATEは許可しない（後述のGRANT/RLSで遮断）。current の
-- 切替はこの関数だけが行える。
--   ・所有権確認: 対象行が属する diagnosis_results を auth.uid() で絞り込み、無ければ例外。
--   ・同時実行対策: 対象 diagnosis_results 行を SELECT ... FOR UPDATE でロックしてから
--     旧current解除→対象行のcurrent化を行うため、同一 diagnosis_result_id への
--     並行呼び出しは直列化され、先勝ちの状態を見てから後続が処理される
--     （部分ユニークインデックス違反のレースは発生しない）。
--   ・ロールバック: 関数内で例外が発生した場合、この関数呼び出し全体が
--     1トランザクションとして自動的に巻き戻る（PostgREST は1呼び出し=1トランザクション）。
--   ・search_path を固定し、SECURITY DEFINER に対する search_path 汚染攻撃を防ぐ。
create or replace function public.activate_ai_output(
  p_ai_output_id uuid
) returns public.diagnosis_ai_outputs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_diagnosis_result_id uuid;
  v_output_type public.ai_output_type;
  v_row public.diagnosis_ai_outputs;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select diagnosis_result_id, output_type
    into v_diagnosis_result_id, v_output_type
    from public.diagnosis_ai_outputs
    where id = p_ai_output_id;

  if not found then
    raise exception 'ai_output not found';
  end if;

  -- 対象診断結果の行ロック＝所有権確認と同時実行の直列化を同時に行う。
  perform 1 from public.diagnosis_results
    where id = v_diagnosis_result_id and user_id = v_uid
    for update;

  if not found then
    raise exception 'diagnosis_result not found or not owned by caller';
  end if;

  update public.diagnosis_ai_outputs
    set is_current = false
    where diagnosis_result_id = v_diagnosis_result_id
      and output_type = v_output_type
      and is_current = true;

  update public.diagnosis_ai_outputs
    set is_current = true
    where id = p_ai_output_id
    returning * into v_row;

  return v_row;
end;
$$;
comment on function public.activate_ai_output is 'create_ai_output()で作成済みのAI生成物を現行版として原子的に有効化する唯一の経路。所有権確認・行ロックによる直列化・固定search_pathを持つSECURITY DEFINER関数。クライアントからの直接UPDATEは許可しない。';

-- diagnosis_results.ai_status を変更する唯一の経路。
-- diagnosis_results は本来イミュータブル（更新ポリシー・更新権限を持たない）だが、
-- AI解説の生成が非同期ジョブになったことで ai_status の遷移(PENDING→GENERATING→READY/FAILED)
-- だけは必要になる。この関数は ai_status 以外の列を一切変更しない。
create or replace function public.set_diagnosis_ai_status(
  p_diagnosis_result_id uuid,
  p_status public.ai_generation_status
) returns public.diagnosis_results
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.diagnosis_results;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.diagnosis_results
    set ai_status = p_status
    where id = p_diagnosis_result_id
      and user_id = v_uid
    returning * into v_row;

  if not found then
    raise exception 'diagnosis_result not found or not owned by caller';
  end if;

  return v_row;
end;
$$;
comment on function public.set_diagnosis_ai_status is 'diagnosis_results.ai_statusのみを変更できる唯一の経路。他の列は変更しない。SECURITY DEFINER、固定search_path。';

-- avatar_path の検証ヘルパー（save_stylist_profile / save_salon_profile で共用）。
-- 「auth.uid()配下のパス」かつ「実際にavatarsバケットに本人所有で存在するオブジェクト」
-- であることを確認し、正規化した値（空文字はNULL化）を返す。条件を満たさなければ例外。
-- クライアントから直接呼び出す必要は無いため、GRANTは一切与えない
-- （呼び出し元のSECURITY DEFINER関数からのみ呼ばれる。呼び出し元が所有者と同じ役割で
-- 実行されるため、ここに個別のGRANTが無くても呼び出せる）。
create or replace function public.validate_and_normalize_avatar_path(
  p_uid uuid,
  p_avatar_path text
) returns text
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_avatar_path text := nullif(trim(p_avatar_path), '');
begin
  if v_avatar_path is not null then
    if split_part(v_avatar_path, '/', 1) <> p_uid::text then
      raise exception 'invalid avatar path: must be under caller''s own folder';
    end if;
    if not exists (
      select 1 from storage.objects
      where bucket_id = 'avatars' and name = v_avatar_path and owner = p_uid
    ) then
      raise exception 'avatar object not found or not owned by caller';
    end if;
  end if;
  return v_avatar_path;
end;
$$;
comment on function public.validate_and_normalize_avatar_path is 'avatar_pathが本人フォルダ配下の実在オブジェクトであることを検証し正規化する内部ヘルパー。save_stylist_profile/save_salon_profileから呼ばれる。クライアントへは公開しない。';

-- ============================================================================
-- ★開発ルール（必読）: save_stylist_profile() と save_salon_profile() の対称性
--
-- この2つの関数は、保存先テーブル（stylist_private/stylist_profiles/
-- user_settings と salon_profiles）以外のロジックを完全に対称（同一構造）に
-- 保つ方針とする。対称であるべき範囲は具体的に以下の6点:
--   1. avatar_path の検証方法（validate_and_normalize_avatar_path()の呼び方）
--   2. トランザクション範囲（1関数=1トランザクション、途中失敗時の扱い）
--   3. profile_version のインクリメント方法（+1のタイミング・条件）
--   4. onboarding_step の更新方法（greatest(onboarding_step, 4)のタイミング・条件）
--   5. UPSERT戦略（INSERT ... ON CONFLICT (user_id) DO UPDATE の形）
--   6. エラーハンドリング（認証チェックの位置・例外の送出方法・戻り値の形）
--
-- 【どちらかを変更する際の必須確認事項】
--   save_stylist_profile() または save_salon_profile() の一方を変更する場合、
--   上記6点のいずれかに関わる変更であれば、もう一方にも同じ変更が必要かを
--   必ず確認すること。対称構造が崩れると、片方だけ孤立ファイル・二重書き込み・
--   不整合なonboarding_step等のバグを踏みやすくなる。
--   対応する TypeScript 側（lib/profile/actions.ts の saveProfileAction と
--   lib/salon/actions.ts の saveSalonProfileAction）も同様に対称構造を
--   維持すること（avatar_path の扱い・旧画像削除のタイミング等）。
-- ============================================================================

-- ---------- save_stylist_profile : プロフィール保存の唯一の経路 ------------
-- stylist_private / stylist_profiles / user_settings / profiles(avatar_path,
-- onboarding_step, profile_version) への書き込みを1トランザクションにまとめる。
-- クライアントはこのRPCのみを呼び出し、各テーブルへの直接INSERT/UPDATEは
-- 許可しない（後述のGRANT/RLSで遮断）。途中で例外が発生した場合は
-- 呼び出し全体がロールバックされ、onboarding_step・profile_versionも進まない。
--   ・avatar_path の検証は validate_and_normalize_avatar_path() を使う
--     （save_salon_profile()と共通のロジック）。
--   ・Storageオブジェクトの削除はこの関数では行わない。旧画像の削除は
--     呼び出し元のServer Actionが、この関数の成功を確認した後にのみ行う
--     （関数内でDBとStorageの両方を変更すると、DBはコミットされたが
--     Storageの削除だけが何らかの理由で不整合になる、といった状態を
--     避けやすくするため。Storage操作をトランザクション境界の外に出す）。
--   ・search_path を固定し、SECURITY DEFINER に対する search_path 汚染攻撃を防ぐ。
--   ・stylist_private / stylist_profiles は行が無ければ作成、あれば更新する
--     upsertのため、handle_new_user()での事前作成が無くても初回保存が正しく動作する。
create or replace function public.save_stylist_profile(
  p_public_name           text,
  p_full_name             text,
  p_age_band              public.age_band,
  p_gender                public.gender_type,
  p_prefecture            text,
  p_desired_work_location text,
  p_experience_years      integer,
  p_current_position      text,
  p_specialties           text[],
  p_employment_type       public.employment_type,
  p_job_change_intent     public.job_change_intent,
  p_desired_salary_range  public.salary_band,
  p_sns_links             jsonb,
  p_bio                   text,
  p_visibility            public.profile_visibility,
  p_scout_enabled         boolean,
  p_avatar_path           text,
  p_value_priorities      text[]
) returns public.profiles
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_avatar_path text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  v_avatar_path := public.validate_and_normalize_avatar_path(v_uid, p_avatar_path);

  -- 対象行をロックしてから更新する（同一ユーザーからの同時保存要求を直列化）。
  perform 1 from public.profiles where id = v_uid for update;

  insert into public.stylist_private (user_id, full_name, age_band, gender)
  values (v_uid, p_full_name, p_age_band, p_gender)
  on conflict (user_id) do update set
    full_name = excluded.full_name,
    age_band  = excluded.age_band,
    gender    = excluded.gender;

  insert into public.stylist_profiles (
    user_id, public_name, visibility, prefecture, desired_work_location,
    experience_years, current_position, specialties, employment_type,
    job_change_intent, desired_salary_range, sns_links, bio, value_priorities
  ) values (
    v_uid, p_public_name, p_visibility, p_prefecture, nullif(trim(p_desired_work_location), ''),
    p_experience_years, nullif(trim(p_current_position), ''), p_specialties, p_employment_type,
    p_job_change_intent, p_desired_salary_range, coalesce(p_sns_links, '[]'::jsonb),
    nullif(trim(p_bio), ''), p_value_priorities
  )
  on conflict (user_id) do update set
    public_name           = excluded.public_name,
    visibility             = excluded.visibility,
    prefecture             = excluded.prefecture,
    desired_work_location  = excluded.desired_work_location,
    experience_years       = excluded.experience_years,
    current_position       = excluded.current_position,
    specialties            = excluded.specialties,
    employment_type        = excluded.employment_type,
    job_change_intent      = excluded.job_change_intent,
    desired_salary_range   = excluded.desired_salary_range,
    sns_links              = excluded.sns_links,
    bio                    = excluded.bio,
    value_priorities       = excluded.value_priorities;

  insert into public.user_settings (user_id, scout_enabled)
  values (v_uid, p_scout_enabled)
  on conflict (user_id) do update set
    scout_enabled = excluded.scout_enabled;

  update public.profiles
    set avatar_path      = v_avatar_path,
        -- ここまでの全ての書き込みに成功した場合のみ到達し、COMPLETEへ進む。
        -- 途中で例外が発生した場合はこのUPDATEも含め全てロールバックされる。
        onboarding_step  = greatest(onboarding_step, 4), -- 4 = ONBOARDING_STEP.COMPLETE（lib/auth/onboarding.tsと値を同期させること）
        profile_version  = profile_version + 1
    where id = v_uid
    returning * into v_profile;

  return v_profile;
end;
$$;
comment on function public.save_stylist_profile is 'プロフィール保存の唯一の経路。stylist_private/stylist_profiles/user_settings/profiles(avatar_path,onboarding_step,profile_version)への書き込みを1トランザクションで行うSECURITY DEFINER関数。stylist_private/stylist_profilesはupsertのため、handle_new_user()での事前作成が無くても初回保存として動作する。Storageの削除は行わない（呼び出し元が成功後に実施）。クライアントからの各テーブル直接書き込みは許可しない。avatar検証・トランザクション範囲・profile_version/onboarding_step更新・エラーハンドリングはsave_salon_profile()と完全に同一構造。差分は書き込み先テーブル（stylist_private/stylist_profiles/user_settings）のみ。p_instagram_handleは廃止しp_sns_links(jsonb)に統合、p_value_priorities(text[]、ちょうど3件)を追加（Phase1美容師オンボーディング拡張分）。';

-- ---------- save_salon_profile : サロンプロフィール保存の唯一の経路 --------
-- save_stylist_profile() と可能な限り対称な構造にしている。
-- salon_profiles / profiles(avatar_path, onboarding_step, profile_version) への
-- 書き込みを1トランザクションにまとめる。salon_private相当のテーブルは
-- 現時点で存在しないため、書き込み対象はsalon_profilesのみ（stylist側の
-- stylist_private・user_settings.scout_enabledに相当する概念は無い）。
-- salon_profilesはupsertのため、handle_new_user()での事前作成が無くても
-- 初回保存として動作する。
create or replace function public.save_salon_profile(
  p_salon_name           text,
  p_prefecture           text,
  p_city                 text,
  p_street_address       text,
  p_culture_description  text,
  p_employee_size_code   text,
  p_target_specialties   text[],
  p_instagram_handle     text,
  p_bio                  text,
  p_visibility           public.profile_visibility,
  p_avatar_path          text
) returns public.profiles
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
  v_avatar_path text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  v_avatar_path := public.validate_and_normalize_avatar_path(v_uid, p_avatar_path);

  -- 対象行をロックしてから更新する（同一ユーザーからの同時保存要求を直列化）。
  perform 1 from public.profiles where id = v_uid for update;

  insert into public.salon_profiles (
    user_id, salon_name, visibility, prefecture, city, street_address,
    culture_description, employee_size_code, target_specialties,
    instagram_handle, bio
  ) values (
    v_uid, p_salon_name, p_visibility, p_prefecture, nullif(trim(p_city), ''),
    nullif(trim(p_street_address), ''), nullif(trim(p_culture_description), ''),
    p_employee_size_code, p_target_specialties,
    nullif(trim(p_instagram_handle), ''), nullif(trim(p_bio), '')
  )
  on conflict (user_id) do update set
    salon_name           = excluded.salon_name,
    visibility            = excluded.visibility,
    prefecture            = excluded.prefecture,
    city                  = excluded.city,
    street_address        = excluded.street_address,
    culture_description   = excluded.culture_description,
    employee_size_code    = excluded.employee_size_code,
    target_specialties    = excluded.target_specialties,
    instagram_handle      = excluded.instagram_handle,
    bio                   = excluded.bio;

  update public.profiles
    set avatar_path      = v_avatar_path,
        -- ここまでの全ての書き込みに成功した場合のみ到達し、COMPLETEへ進む。
        -- 途中で例外が発生した場合はこのUPDATEも含め全てロールバックされる。
        onboarding_step  = greatest(onboarding_step, 4), -- 4 = ONBOARDING_STEP.COMPLETE（lib/auth/onboarding.tsと値を同期させること）
        profile_version  = profile_version + 1
    where id = v_uid
    returning * into v_profile;

  return v_profile;
end;
$$;
comment on function public.save_salon_profile is 'サロンプロフィール保存の唯一の経路。SECURITY DEFINER関数。avatar検証・トランザクション範囲・profile_version/onboarding_step更新・エラーハンドリングはsave_stylist_profile()と完全に同一構造。差分は書き込み先テーブル（salon_profilesのみ。stylist側のstylist_private・user_settings.scout_enabledに相当するテーブルは無い）のみ。salon_profilesはupsertのため、handle_new_user()での事前作成が無くても初回保存として動作する。クライアントからの直接書き込みは許可しない。';

-- ---------- updated_at triggers -------------------------------------------
create trigger trg_profiles_updated         before update on public.profiles         for each row execute function public.set_updated_at();
create trigger trg_stylist_private_updated  before update on public.stylist_private  for each row execute function public.set_updated_at();
create trigger trg_stylist_profiles_updated before update on public.stylist_profiles for each row execute function public.set_updated_at();
create trigger trg_salon_profiles_updated   before update on public.salon_profiles   for each row execute function public.set_updated_at();
create trigger trg_user_settings_updated    before update on public.user_settings    for each row execute function public.set_updated_at();

-- ============================================================================
-- Row Level Security
-- ============================================================================
alter table public.profiles            enable row level security;
alter table public.stylist_private     enable row level security;
alter table public.stylist_profiles    enable row level security;
alter table public.salon_profiles      enable row level security;
alter table public.user_settings       enable row level security;
alter table public.diagnosis_results   enable row level security;
alter table public.diagnosis_ai_outputs enable row level security;
alter table public.pending_diagnoses   enable row level security;  -- ポリシー無し＝全拒否

-- profiles : SELECTのみ本人に許可。INSERTはhandle_new_user()トリガー(security definer)、
-- UPDATE(avatar_path/onboarding_step)はsave_stylist_profile()経由のみに限定する。
create policy profiles_select_own on public.profiles for select using (id = auth.uid());

-- stylist_private : SELECTのみ本人に許可。作成・更新ともsave_stylist_profile()経由のみ
-- （handle_new_user()では作成しない。DELETEポリシーは元々無し＝クライアント削除不可）。
create policy stylist_private_select_own on public.stylist_private for select using (user_id = auth.uid());

-- stylist_profiles : SELECTのみ本人に許可。作成・更新ともsave_stylist_profile()経由のみ
-- （handle_new_user()では作成しない。将来サロンへは visibility に応じて別途ビュー/ポリシーで公開）。
create policy stylist_profiles_select_own on public.stylist_profiles for select using (user_id = auth.uid());

-- salon_profiles : SELECTのみ本人に許可。作成・更新ともsave_salon_profile()経由のみ
-- （handle_new_user()では作成しない。stylist_profilesと対称構造）。
create policy salon_profiles_select_own on public.salon_profiles for select using (user_id = auth.uid());

-- user_settings : SELECTのみ本人に許可。書き込みはsave_stylist_profile()経由のみ。
create policy user_settings_select_own on public.user_settings for select using (user_id = auth.uid());

-- diagnosis_results : 本人のみ SELECT/INSERT（UPDATE/DELETEポリシー・権限は無い）。
-- ただし ai_status のみ set_diagnosis_ai_status() RPC(SECURITY DEFINER)経由で変更可能
-- （グラント/RLSの制約を受けずに、ai_status以外の列は一切変更しない形で書き込む）。
create policy diagnosis_results_select_own on public.diagnosis_results for select using (user_id = auth.uid());
create policy diagnosis_results_insert_own on public.diagnosis_results for insert with check (user_id = auth.uid());

-- diagnosis_ai_outputs : SELECTのみ本人の診断結果に紐づく行を許可。
-- INSERT/UPDATEいずれもクライアントから直接行えない（GRANTを与えない）。
-- AI出力の新規作成は create_ai_output()、current切替は activate_ai_output() のみが行う
-- （いずれもSECURITY DEFINERとして動作するため、グラント/RLSの制約を受けずに書き込める）。
create policy diagnosis_ai_outputs_select_own on public.diagnosis_ai_outputs
  for select using (
    exists (
      select 1 from public.diagnosis_results dr
      where dr.id = diagnosis_ai_outputs.diagnosis_result_id
        and dr.user_id = auth.uid()
    )
  );

-- ============================================================================
-- テーブル権限（RLSは許可を絞るだけなので GRANT が別途必要）
-- anon(未ログイン) には上記テーブルへの権限を与えない。
-- pending_diagnoses は誰にも与えない（service role のみが操作）。
--
-- profiles / stylist_private / stylist_profiles / user_settings / diagnosis_ai_outputs は
-- SELECTのみ許可し、書き込みはSECURITY DEFINER RPC(save_stylist_profile /
-- create_ai_output / activate_ai_output)経由に限定する。直接INSERT/UPDATE権限は与えない。
-- ============================================================================
grant select               on public.profiles             to authenticated;
grant select               on public.stylist_private      to authenticated;
grant select               on public.stylist_profiles     to authenticated;
grant select               on public.salon_profiles       to authenticated;
grant select               on public.user_settings         to authenticated;
grant select, insert       on public.diagnosis_results    to authenticated;
grant select               on public.diagnosis_ai_outputs to authenticated;

-- 関数はCREATE時点でPUBLICにEXECUTEが自動付与されるため、明示的に剥奪してから
-- authenticatedのみへ付与する（anon・未認証ロールからは実行できない）。
revoke all on function public.save_stylist_profile(
  text, text, public.age_band, public.gender_type, text, text, integer, text,
  text[], public.employment_type, public.job_change_intent, public.salary_band,
  jsonb, text, public.profile_visibility, boolean, text, text[]
) from public;
revoke all on function public.save_stylist_profile(
  text, text, public.age_band, public.gender_type, text, text, integer, text,
  text[], public.employment_type, public.job_change_intent, public.salary_band,
  jsonb, text, public.profile_visibility, boolean, text, text[]
) from anon;
revoke all on function public.save_salon_profile(
  text, text, text, text, text, text, text[], text, text, public.profile_visibility, text
) from public;
revoke all on function public.save_salon_profile(
  text, text, text, text, text, text, text[], text, text, public.profile_visibility, text
) from anon;
-- validate_and_normalize_avatar_path は内部ヘルパー。クライアントには一切GRANTしない
-- （save_stylist_profile/save_salon_profileがSECURITY DEFINERとして内部から呼ぶため
-- 個別のGRANTが無くても動作する）。
revoke all on function public.validate_and_normalize_avatar_path(uuid, text) from public;
revoke all on function public.validate_and_normalize_avatar_path(uuid, text) from anon;
revoke all on function public.validate_and_normalize_avatar_path(uuid, text) from authenticated;
revoke all on function public.create_ai_output(
  uuid, public.ai_output_type, text, text, text, jsonb
) from public;
revoke all on function public.create_ai_output(
  uuid, public.ai_output_type, text, text, text, jsonb
) from anon;
revoke all on function public.activate_ai_output(uuid) from public;
revoke all on function public.activate_ai_output(uuid) from anon;
revoke all on function public.start_pending_diagnosis_claim(uuid) from public;
revoke all on function public.start_pending_diagnosis_claim(uuid) from anon;
revoke all on function public.complete_pending_diagnosis_claim(uuid) from public;
revoke all on function public.complete_pending_diagnosis_claim(uuid) from anon;
revoke all on function public.set_diagnosis_ai_status(uuid, public.ai_generation_status) from public;
revoke all on function public.set_diagnosis_ai_status(uuid, public.ai_generation_status) from anon;
-- cleanup_expired_pending_diagnoses は誰にもGRANTしない（pg_cron/service role専用）。
revoke all on function public.cleanup_expired_pending_diagnoses() from public;
revoke all on function public.cleanup_expired_pending_diagnoses() from anon;
revoke all on function public.cleanup_expired_pending_diagnoses() from authenticated;

grant execute on function public.save_stylist_profile(
  text, text, public.age_band, public.gender_type, text, text, integer, text,
  text[], public.employment_type, public.job_change_intent, public.salary_band,
  jsonb, text, public.profile_visibility, boolean, text, text[]
) to authenticated;
grant execute on function public.save_salon_profile(
  text, text, text, text, text, text, text[], text, text, public.profile_visibility, text
) to authenticated;
grant execute on function public.create_ai_output(
  uuid, public.ai_output_type, text, text, text, jsonb
) to authenticated;
grant execute on function public.activate_ai_output(uuid) to authenticated;
grant execute on function public.start_pending_diagnosis_claim(uuid) to authenticated;
grant execute on function public.complete_pending_diagnosis_claim(uuid) to authenticated;
grant execute on function public.set_diagnosis_ai_status(uuid, public.ai_generation_status) to authenticated;

-- ============================================================================
-- Storage: プロフィール画像用バケット（非公開・署名付きURL方式）
--
-- stylist_profiles.visibility=PRIVATE のユーザーの画像がURLを知るだけで
-- 誰でも閲覧できてしまうことは設計と矛盾するため、バケットは非公開(public=false)とし、
-- 表示時はサーバー側で都度 createSignedUrl() により期限付きURLを発行する
-- （lib/profile/get-initial-values.ts, components/profile/avatar-uploader.tsx）。
-- 現時点ではSELECTポリシーも本人のみに限定している（visibility=PUBLIC/LIMITEDの
-- ユーザーの画像を他ユーザー・サロンへ公開する機能はまだ存在しないため）。
-- 将来サロン側の閲覧機能を実装する際は、visibilityを見るSELECTポリシー
-- （もしくは署名付きURLを発行するEdge Function側でvisibilityを確認する方式）に
-- 拡張が必要。
--
-- file_size_limit(5MB)・allowed_mime_types はバケット側の設定でサーバー側に
-- 強制する（クライアントのJSチェックはUXのためのものであり、正の保証はここ）。
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 読み取りは本人のみ（非公開バケット。表示は署名付きURL経由）。
create policy avatars_select_own on storage.objects
  for select using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_insert_own on storage.objects
  for insert with check (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_update_own on storage.objects
  for update using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_delete_own on storage.objects
  for delete using (
    bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================================
-- 新規ユーザー作成時に profiles / user_settings の既定行を作る。
-- stylist_profiles / stylist_private / salon_profiles はここでは作成しない
-- （空プロフィールの量産を避けるため、それぞれの save_*_profile() RPC の
-- upsertに一本化する。行が無くても各RPCの ON CONFLICT (user_id) DO UPDATE が
-- 初回はINSERT相当として機能するため、事前作成が無くても問題なく動作する）。
--
-- role は raw_user_meta_data->>'role' を見て決定する。ただし 'stylist'/'salon'
-- 以外の値（特に 'admin'）は無視して既定の 'stylist' にフォールバックする。
-- signUpのoptions.dataはクライアントが自由に送れる値のため、ここで
-- admin権限を自己付与されることを構造的に防いでいる。
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_requested_role text := new.raw_user_meta_data->>'role';
  v_role public.user_role;
begin
  if v_requested_role in ('stylist', 'salon') then
    v_role := v_requested_role::public.user_role;
  else
    v_role := 'stylist';
  end if;

  insert into public.profiles (id, role)
  values (new.id, v_role);

  insert into public.user_settings (user_id)
  values (new.id);

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- account_recovery_requests : 「登録メールアドレスが分からない方」向けの
-- 問い合わせフォーム(/account-recovery)の送信先。
--
-- 設計方針:
--  * このテーブルはメールアドレス・アカウントの存在確認を行う機能ではない。
--    単に問い合わせ内容を保存するだけで、既存アカウントとの照合・自動応答は
--    一切行わない（auth.usersやprofiles等を検索するロジックはどこにも実装しない）。
--  * RLSは有効・ポリシーは一切付けない（pending_diagnosesと同じ「ブラックボックス」
--    方式）。送信者自身を含め、クライアントからは書き込みはおろか読み出しも一切できない。
--    書き込みはservice roleを使うRoute Handler(app/api/account-recovery)経由のみ。
--  * 本人確認後のメールアドレス変更・旧アカウントから新アカウントへのデータ移行は
--    アプリ側では自動化しない。管理者がSupabase Studio等でこのテーブルを確認し、
--    手動で対応する運用を前提とする（status列は管理者が手動で更新する想定）。
-- ============================================================================
create type public.account_recovery_account_type as enum ('stylist', 'salon');
create type public.account_recovery_status as enum ('PENDING', 'RESOLVED');

create table public.account_recovery_requests (
  id                  uuid primary key default gen_random_uuid(),
  display_name        text not null check (char_length(display_name) <= 60),
  account_type         public.account_recovery_account_type not null,
  salon_name           text not null check (char_length(salon_name) <= 60),
  prefecture           text not null check (char_length(prefecture) <= 20),
  instagram_handle     text check (instagram_handle is null or char_length(instagram_handle) <= 40),
  approximate_period   text not null check (char_length(approximate_period) <= 100),
  contact_email        text not null check (char_length(contact_email) <= 320),
  notes                text check (notes is null or char_length(notes) <= 2000),
  status               public.account_recovery_status not null default 'PENDING',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.account_recovery_requests is '「登録メールアドレスが分からない方」向け問い合わせの保存先。アカウントの存在確認・自動照合は一切行わない。RLSポリシー無し＝クライアントからは書き込み・読み出しとも不可。service role経由のINSERTのみ。本人確認・メールアドレス変更・データ移行は管理者が手動で対応する（statusを手掛かりに管理者がSupabase Studio等で対応する運用）。';
comment on column public.account_recovery_requests.contact_email is '現在連絡可能なメールアドレス（登録時のメールアドレスとは限らない）。本人確認のための連絡先であり、既存アカウントとの自動照合には使わない。';

create trigger trg_account_recovery_requests_updated
  before update on public.account_recovery_requests
  for each row execute function public.set_updated_at();

alter table public.account_recovery_requests enable row level security;
-- ポリシーは意図的に一切作らない。

-- authenticated/anonへは一切GRANTしない（元々与えていないが、明示的にREVOKEし、
-- service role以外から直接SELECT/INSERT/UPDATE/DELETEできないことを保証する）。
revoke all on public.account_recovery_requests from anon;
revoke all on public.account_recovery_requests from authenticated;
revoke all on public.account_recovery_requests from public;
