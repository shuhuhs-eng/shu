// Supabase Database 型（手書き）。将来は `supabase gen types typescript` で自動生成に置換可。
export type Json =
  | string | number | boolean | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "stylist" | "salon" | "admin";
export type GenderType = "male" | "female" | "other" | "prefer_not_to_say";
export type AgeBand =
  | "under_20" | "20_24" | "25_29" | "30_34" | "35_39" | "40_44" | "45_plus" | "prefer_not_to_say";
export type EmploymentType = "full_time" | "part_time" | "contract" | "freelance" | "owner" | "other";
export type JobChangeIntent = "active" | "passive" | "not_looking";
export type SalaryBand = "lt_350" | "350_450" | "450_600" | "600_800" | "gt_800" | "flexible";
export type DiagnosisModeDb = "stylist" | "salon";
export type ProfileVisibility = "PRIVATE" | "LIMITED" | "PUBLIC";
export type AiOutputType = "essence" | "explanation" | "advice" | "growth";
/** stylist_profiles.sns_links の要素。将来platformの種類を増やしてもマイグレーション不要。 */
export type SnsLink = { platform: string; handle: string };
export type PendingDiagnosisClaimStatus = "PENDING" | "PROCESSING" | "COMPLETED";
export type AiGenerationStatus = "PENDING" | "GENERATING" | "READY" | "FAILED";
export type AccountRecoveryAccountType = "stylist" | "salon";
export type AccountRecoveryStatus = "PENDING" | "RESOLVED";
export type StylistCoreType =
  | "shimei_jishaku"
  | "aisare_ace"
  | "niaiwase_master"
  | "trend_maker"
  | "iyashi_charisma"
  | "repeat_king"
  | "mirai_no_ace"
  | "brand_builder";

export type SalonCultureRespondentRole =
  | "owner_representative"
  | "store_manager"
  | "recruiter_hr"
  | "other";
export type SalonCultureStatus = "draft" | "completed";

export type StylistPreferenceStatus = "draft" | "completed";
/** 0014で追加。salon_photos.category のCHECK制約と一致。 */
export type SalonPhotoCategory = "interior" | "atmosphere";
/** 0015で追加。salon_links.link_type のCHECK制約と一致。 */
export type SalonLinkType = "website" | "recruit" | "instagram" | "hotpepper" | "other";
/** 美容師「働きたいサロン環境」Preference(8軸)。既存30問診断とは別物。
 *  値は0/25/50/75/100（1〜5の回答を(値-1)*25で変換）。未回答の軸はキー自体が
 *  存在しない場合がある。 */
export type StylistPreferenceAxes = Partial<{
  education_preference: number;
  challenge_preference: number;
  personal_brand_preference: number;
  collaboration_preference: number;
  autonomy_preference: number;
  work_flexibility_preference: number;
  relationship_distance_preference: number;
  hierarchy_preference: number;
}>;

/** Sprint1では team_collaboration_style は未算出のため、キー自体が存在しない場合がある。
 *  0009で新12軸（education_support / challenge_openness / personal_brand_support は
 *  軸名を維持しつつ新方式へ統合、残り9軸を新規追加）を導入した。旧の
 *  management_style / customer_relationship_style / team_collaboration_style は、
 *  既存データ（新12問へ回答し直していないサロン）を型として引き続き表現できるよう
 *  削除していない。新規保存分にはこの3キーは含まれない（0009のRPC参照）。 */
export type SalonCultureAxes = Partial<{
  education_support: number;
  challenge_openness: number;
  personal_brand_support: number;
  management_style: number;
  customer_relationship_style: number;
  team_collaboration_style: number;
  // ★0009で追加した新9軸。
  team_collaboration: number;
  individual_autonomy: number;
  work_flexibility: number;
  technical_specialization: number;
  premium_value: number;
  trend_orientation: number;
  creative_output: number;
  relationship_distance: number;
  hierarchy_flatness: number;
}>;

type Timestamps = { created_at: string; updated_at: string };

export type Database = {
  // 【重要】このマーカーは @supabase/supabase-js 2.112.2 では49件の型エラーの
  // 解消には至らなかった（実機npm run typecheckで確認済み）。原因は
  // @supabase/ssr@0.5.2（0.x系＝pre-1.0）と@supabase/supabase-js 2.112.2の
  // 組み合わせ自体の非互換の可能性が高いと判断し、package.jsonでは
  // @supabase/supabase-js を 2.45.4 に固定する方針とした（package.json参照）。
  // 2.45.4を前提とする場合、このマーカーはおそらく参照されず無害な未使用
  // プロパティになる。将来 @supabase/ssr と @supabase/supabase-js を両方
  // 意図的にアップグレードする場合は、`npm list @supabase/postgrest-js`で
  // 実際のバージョンを確認しこの値を見直すこと（推測で値を変更しない）。
  __InternalSupabase: {
    PostgrestVersion: "12.2.3";
  };
  public: {
    Tables: {
      profiles: {
        // display_name は持たない（表示名は stylist_profiles.public_name）。
        // onboarded(boolean) は廃止し onboarding_step(int) で進捗を管理する。
        // avatar_path は avatarsバケット(非公開)内のパスのみを保持し、URLは持たない。
        // 書き込みは save_stylist_profile() RPC経由のみ（直接INSERT/UPDATE権限は無い）。
        Row: { id: string; role: UserRole; avatar_path: string | null; onboarding_step: number; profile_version: number } & Timestamps;
        Insert: Record<string, never>; // 直接INSERT不可（handle_new_userトリガーがsecurity definerで作成）
        Update: Record<string, never>; // 直接UPDATE不可（save_stylist_profile() RPC経由のみ）
        Relationships: [];
      };
      stylist_private: {
        // 書き込みは save_stylist_profile() RPC経由のみ（直接INSERT/UPDATE権限は無い）。
        // handle_new_user()では作成しない（upsertのため事前作成不要）。
        Row: { user_id: string; full_name: string | null; age_band: AgeBand | null; gender: GenderType | null } & Timestamps;
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      stylist_profiles: {
        // 書き込みは save_stylist_profile() RPC経由のみ（直接INSERT/UPDATE権限は無い）。
        // handle_new_user()では作成しない（upsertのため事前作成不要）。
        Row: {
          user_id: string; public_name: string | null; visibility: ProfileVisibility;
          prefecture: string | null; desired_work_location: string | null;
          experience_years: number | null; current_position: string | null; specialties: string[];
          employment_type: EmploymentType | null; job_change_intent: JobChangeIntent;
          desired_salary_range: SalaryBand | null;
          /** @deprecated sns_linksへ統合済み。save_stylist_profile()は以後書き込まない。 */
          instagram_handle: string | null;
          bio: string | null;
          sns_links: SnsLink[];
          value_priorities: string[] | null;
        } & Timestamps;
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      salon_profiles: {
        // save_stylist_profileと対称構造。書き込みは save_salon_profile() RPC経由のみ。
        // handle_new_user()では作成しない（upsertのため事前作成不要）。
        // hotpepper_url: 0014で追加。null許容、https://beauty.hotpepper.jp/ 配下のみ
        // （CHECK制約）。
        Row: {
          user_id: string; salon_name: string | null; visibility: ProfileVisibility;
          prefecture: string | null; city: string | null; street_address: string | null;
          culture_description: string | null; employee_size_code: string | null;
          target_specialties: string[]; instagram_handle: string | null; bio: string | null;
          hotpepper_url: string | null;
        } & Timestamps;
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      salon_photos: {
        // 0014で追加。サロンの内装(interior)・雰囲気(atmosphere)画像、各カテゴリ
        // 最大3枚。書き込みは add_salon_photo() / update_salon_photo_sort_order() /
        // delete_salon_photo() RPC経由のみ。RLSはSELECTも本人のみ（美容師からの
        // 直接SELECTは不可。PUBLICサロンの閲覧は0015のget_public_salon_photos()経由）。
        Row: {
          id: string; salon_user_id: string; category: SalonPhotoCategory;
          storage_path: string; sort_order: number; created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      salon_links: {
        // 0015で追加。サロンの外部リンク（最大5件）。salon_photosとは異なり、
        // RLSでサロン本人が直接INSERT/UPDATE/DELETE可能（RPC経由に限定しない）。
        // 美容師からの直接SELECTはRLSで許可せず、get_public_salon_links()経由のみ。
        Row: {
          id: string; salon_user_id: string; link_type: SalonLinkType;
          label: string | null; url: string; sort_order: number; created_at: string;
        };
        Insert: {
          id?: string; salon_user_id: string; link_type: SalonLinkType;
          label?: string | null; url: string; sort_order: number; created_at?: string;
        };
        Update: {
          id?: string; salon_user_id?: string; link_type?: SalonLinkType;
          label?: string | null; url?: string; sort_order?: number; created_at?: string;
        };
        Relationships: [];
      };
      employee_size_master: {
        // 従業員数区分マスタ。SELECTのみ(is_active行のみ)。authenticatedに閲覧を許可。
        Row: { code: string; label: string; sort_order: number; is_active: boolean };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      user_settings: {
        // 書き込みは save_stylist_profile() RPC経由のみ（直接INSERT/UPDATE権限は無い）。
        Row: { user_id: string; scout_enabled: boolean; scout_prefs: Json; notify_email: boolean; line_linked: boolean } & Timestamps;
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      pending_diagnoses: {
        // RLSポリシー・authenticated/anonへのGRANTは一切無い（service role専用テーブル）。
        // INSERT: app/api/diagnosis/guest（service roleクライアント）が行う。
        // UPDATE: start/complete_pending_diagnosis_claim() RPC(SECURITY DEFINER)経由のみ。
        // TypeScript上のInsert/Update型は「service roleクライアントが実際に送る形」を表す
        // ものであり、authenticated/anonのクライアントでは実行時にDB側のGRANTが無いため
        // 拒否される（型だけでは呼び出し元の権限までは表現できない点に注意）。
        Row: {
          id: string; claim_token: string; mode: DiagnosisModeDb; answers: Json;
          diagnosis_version: string; created_at: string; expires_at: string;
          claim_status: PendingDiagnosisClaimStatus;
          claimed_by: string | null; claimed_at: string | null;
        };
        Insert: {
          id?: string; claim_token?: string; mode?: DiagnosisModeDb; answers: Json;
          diagnosis_version: string; created_at?: string; expires_at?: string;
          claim_status?: PendingDiagnosisClaimStatus;
          claimed_by?: string | null; claimed_at?: string | null;
        };
        Update: Record<string, never>; // start/complete_pending_diagnosis_claim() RPC経由のみ
        Relationships: [];
      };
      account_recovery_requests: {
        // RLSポリシー・authenticated/anonへのGRANTは一切無い（service role専用テーブル）。
        // 「登録メールアドレスが分からない方」向け問い合わせの保存先。既存アカウントとの
        // 自動照合・存在確認は一切行わない。書き込みは app/api/account-recovery
        // （service roleクライアント）のみ。読み出しは誰も（送信者本人含め）できない。
        Row: {
          id: string; display_name: string; account_type: AccountRecoveryAccountType;
          salon_name: string; prefecture: string; instagram_handle: string | null;
          approximate_period: string; contact_email: string; notes: string | null;
          status: AccountRecoveryStatus; created_at: string;
        };
        Insert: {
          id?: string; display_name: string; account_type: AccountRecoveryAccountType;
          salon_name: string; prefecture: string; instagram_handle?: string | null;
          approximate_period: string; contact_email: string; notes?: string | null;
          status?: AccountRecoveryStatus; created_at?: string;
        };
        Update: Record<string, never>; // アプリからは更新しない(管理者が手動対応)
        Relationships: [];
      };
      stylist_core_type_history: {
        // RLS: SELECTのみ(本人)。INSERT/UPDATEのGRANTは無い。書き込みは
        // save_core_type_result() RPC専用(クライアントからの直接書き込み不可)。
        Row: {
          id: string; user_id: string; diagnosis_result_id: string;
          top_type_code: StylistCoreType; second_type_code: StylistCoreType;
          score_gap: number; match_scores: Json; created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      stylist_core_type_assignments: {
        // RLS: SELECTのみ(本人)。INSERT/UPDATEのGRANTは無い。書き込みは
        // save_core_type_result() RPC専用。初回のみ作成され、以後上書きされない
        // （将来のstability_algorithm用UPDATE経路は別途専用RPCで追加する想定）。
        Row: {
          user_id: string; core_type_code: StylistCoreType;
          source_diagnosis_result_id: string; assignment_method: string;
          assigned_at: string; updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      user_roles: {
        // RLS: SELECTのみ(本人)。INSERT/UPDATE/DELETEのGRANTは無い。書き込みは
        // save_stylist_profile()/save_salon_profile() RPCのオンボーディング
        // 完了時のみ(複数role対応)。
        Row: {
          user_id: string; role: UserRole; created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      salon_culture_profiles: {
        // RLS: SELECTのみ(本人)。INSERT/UPDATEのGRANTは無い。書き込みは
        // save_salon_culture_profile() RPC専用(クライアントからの直接書き込み不可)。
        // Sprint1: current_cultureのみ。aspired_cultureは無い。
        Row: {
          id: string; salon_user_id: string; status: SalonCultureStatus;
          respondent_role: SalonCultureRespondentRole | null; respondent_user_id: string | null;
          current_step: number; answers: Json; culture_axes: SalonCultureAxes | null;
          value_priorities: string[] | null; comment: string | null; ai_summary: string | null;
        } & Timestamps;
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      stylist_preference_profiles: {
        // RLS: SELECTのみ(本人)。INSERT/UPDATEのGRANTは無い。書き込みは
        // save_stylist_preference_profile() RPC専用(クライアントからの直接書き込み不可)。
        // 美容師「働きたいサロン環境」Preference(8軸)。既存30問診断とは別物。
        Row: {
          id: string; stylist_user_id: string; status: StylistPreferenceStatus;
          current_step: number; answers: Json; preference_axes: StylistPreferenceAxes | null;
        } & Timestamps;
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      stylist_favorite_salons: {
        // 0017で追加。SELECTは美容師本人のみ、書き込みはset_favorite_salon() RPC専用。
        Row: { stylist_user_id: string; salon_user_id: string; created_at: string };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      stylist_salon_interests: {
        // 0018で追加。美容師本人は送信状態のみSELECT可。書き込みは専用RPC。
        // 0032でstore_id、0035でid(surrogate PK)を追加し、salon_user_idをnullable化。
        // store単位Interest(set_store_interest)ではsalon_user_idはNULLのまま保存される。
        Row: {
          id: string; stylist_user_id: string; salon_user_id: string | null;
          store_id: string | null; created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      stylist_match_profiles: {
        Row: {
          stylist_user_id: string; primary_goal: string; secondary_goals: string[];
          career_stage: string; evidence_period_months: number | null;
          avg_monthly_technical_sales: number | null; avg_monthly_retail_sales: number | null;
          avg_monthly_clients: number | null; avg_monthly_named_clients: number | null;
          average_ticket: number | null; repeat_rate: number | null;
          monthly_working_days: number | null; average_daily_hours: number | null;
          self_acquired_clients: number | null; expected_transfer_clients: number | null;
          assistant_usage: string | null; wants_performance_offer: boolean; status: string;
          verification_status: string; consistency_issues: string[];
          created_at: string; updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      stylist_evidence_documents: {
        Row: {
          id: string; stylist_user_id: string; document_type: string;
          storage_path: string; original_file_name: string;
          review_status: string; review_reason: string | null; review_note: string | null;
          reviewed_by: string | null; created_at: string; reviewed_at: string | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      platform_admins: {
        Row: { user_id: string; created_at: string };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      stylist_match_verification_snapshots: {
        // 承認時点の主要4項目のみを保持する変更検知用の記録。
        // 「4項目すべてを資料が証明した」という意味は持たない
        // （0022_performance_salary_offers.sqlのコメント参照）。
        Row: {
          id: string; stylist_user_id: string; evidence_document_id: string | null;
          avg_monthly_technical_sales: number | null; avg_monthly_clients: number | null;
          avg_monthly_named_clients: number | null; average_ticket: number | null;
          verified_by: string | null; verified_at: string; created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      notifications: {
        // typeはDB側CHECK制約で許容値を列挙している(0023_notifications.sql参照)。
        // 書き込みはcreate_notification/mark_notification_read/
        // mark_all_notifications_read(いずれもSECURITY DEFINER)経由のみ。
        Row: {
          id: string; user_id: string; type: string; title: string; message: string;
          related_entity_type: string | null; related_entity_id: string | null;
          is_read: boolean; created_at: string; read_at: string | null;
          // 0038で追加。通知の遷移先（アプリ内の相対パス）。nullなら従来どおりtypeごとの固定遷移先。
          link_path: string | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      salary_offers: {
        Row: {
          id: string; salon_user_id: string; stylist_user_id: string;
          monthly_guarantee: number; performance_addition: number;
          performance_condition: string | null; guarantee_months: number;
          salon_message: string | null; status: string; response_reason: string | null;
          response_note: string | null; responded_at: string | null;
          created_at: string; updated_at: string;
          // 0032で追加。旧create_salary_offer経由の行ではstore_idがnullのことがある。
          store_id: string | null; created_by_user_id: string | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      scouts: {
        // 0025で追加。SELECTはsalon_user_id/stylist_user_id本人のみ。
        // 書き込みはsend_scout/mark_scout_read/respond_scout経由のみ。
        // store_id/created_by_user_idは0032で追加済みの列（Phase 5で型定義を追従）。
        Row: {
          id: string; salon_user_id: string; stylist_user_id: string;
          message: string; template_type: string | null; matching_score: number | null;
          read_status: string; response_status: string; response_message: string | null;
          sent_at: string; read_at: string | null; responded_at: string | null;
          created_at: string; store_id: string | null; created_by_user_id: string | null;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      salon_scout_quotas: {
        // 0025で追加。SELECTはsalon_user_id本人のみ。書き込みRPCはVer.1では
        // 用意しない（行が無いサロンはsend_scout側でデフォルト値として扱う）。
        Row: {
          salon_user_id: string; monthly_free_limit: number; additional_credits: number;
          updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      salon_organizations: {
        // 0026で追加。SELECTはis_organization_member()経由でアクセス可能な
        // 会社のみ（0026 RLS）。legacy_salon_user_idは0027で追加（旧
        // salon_profilesバックフィル専用のprovenance、新規登録ではNULL）。
        // 書き込みはsave_salon_profile() RPC経由のみ。
        Row: {
          id: string; name: string; status: string;
          legacy_salon_user_id: string | null;
          // 0043で追加。年度の開始月(1〜12、既定4)。会社のメンバーなら読める。変更は運営者のみ。
          fiscal_year_start_month: number;
          created_at: string; updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      salon_stores: {
        // 0026で追加。SELECTはis_store_accessible()経由でアクセス可能な
        // 店舗のみ（0026 RLS）。legacy_salon_user_idは0027で追加（旧
        // salon_profilesバックフィル専用のprovenance、新規登録ではNULL）。
        // 書き込みはsave_salon_profile() RPC経由のみ。
        Row: {
          id: string; organization_id: string; store_name: string; status: string;
          usage_status: string; prefecture: string | null; city: string | null;
          legacy_salon_user_id: string | null;
          created_at: string; updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      organization_members: {
        // 0026で追加。SELECTは自分の行のみ（RLS: organization_members_select_own）。
        // UIで書き込みボタンの出し分け（表示上のヒント）にだけ使う。権限の本体はDB(RPC)側。
        Row: { organization_id: string; user_id: string; role: string; created_at: string };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      store_members: {
        // 0026で追加。SELECTは自分の行のみ（RLS: store_members_select_own）。
        Row: { store_id: string; user_id: string; role: string; created_at: string };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      diagnosis_results: {
        // AI生成物(ai_essence等)は持たない。diagnosis_ai_outputs を参照。
        Row: {
          id: string; user_id: string; diagnosis_version: string; mode: DiagnosisModeDb; answers: Json;
          craft_score: number; sense_score: number; hospitality_score: number;
          brand_score: number; drive_score: number; mentor_score: number;
          type_id: string; type_name: string; market_value_score: number | null; salary_band: string | null;
          source_pending_id: string | null; ai_status: AiGenerationStatus; created_at: string;
        };
        Insert: {
          id?: string; user_id: string; diagnosis_version: string; mode?: DiagnosisModeDb; answers: Json;
          craft_score: number; sense_score: number; hospitality_score: number;
          brand_score: number; drive_score: number; mentor_score: number;
          type_id: string; type_name: string; market_value_score?: number | null; salary_band?: string | null;
          source_pending_id?: string | null; ai_status?: AiGenerationStatus; created_at?: string;
        };
        // ai_status以外は不変。ai_statusもset_diagnosis_ai_status() RPC経由でのみ変更可能
        // （直接UPDATE権限は無い）。
        Update: Record<string, never>;
        Relationships: [];
      };
      diagnosis_ai_outputs: {
        // 書き込み(INSERT/UPDATEとも)は create_ai_output() / activate_ai_output() RPC経由のみ。
        Row: {
          id: string; diagnosis_result_id: string; output_type: AiOutputType;
          provider: string; model: string; prompt_version: string;
          response: Json; is_current: boolean; created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      salon_culture_ai_outputs: {
        // 書き込み(INSERT/UPDATEとも)は create_salon_culture_ai_output() /
        // activate_salon_culture_ai_output() RPC経由のみ。diagnosis_results/
        // 旧14問診断には一切依存しない（salon_culture_profiles(id)に直接紐づく）。
        Row: {
          id: string; salon_culture_profile_id: string; output_type: AiOutputType;
          provider: string; model: string; prompt_version: string;
          response: Json; is_current: boolean; created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      salon_store_profiles: {
        // 0029で追加。店舗単位プロフィール。store_idが主軸（auth userはPKに
        // しない）。SELECTはis_store_accessible()経由でアクセス可能な店舗のみ
        // （0029 RLS）。書き込みはsave_salon_store_profile() RPC経由のみ(0030)。
        Row: {
          store_id: string; salon_name: string | null; visibility: ProfileVisibility;
          prefecture: string | null; city: string | null; street_address: string | null;
          culture_description: string | null; employee_size_code: string | null;
          target_specialties: string[]; bio: string | null; hotpepper_url: string | null;
        } & Timestamps;
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      salon_store_culture_profiles: {
        // 0029で追加。店舗単位の「サロンらしさ」12軸診断。store_idが主軸
        // （salon_user_idは持たない）。SELECTはis_store_accessible()経由で
        // アクセス可能な店舗のみ（0029 RLS）。書き込みは
        // save_salon_store_culture_profile() RPC経由のみ(0030)。
        Row: {
          id: string; store_id: string; status: SalonCultureStatus;
          respondent_role: SalonCultureRespondentRole | null; respondent_user_id: string | null;
          current_step: number; answers: Json; culture_axes: SalonCultureAxes | null;
          value_priorities: string[] | null; comment: string | null; ai_summary: string | null;
        } & Timestamps;
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      save_stylist_profile: {
        Args: {
          p_public_name: string;
          p_full_name: string;
          p_age_band: AgeBand;
          p_gender: GenderType;
          p_prefecture: string;
          p_desired_work_location: string | null;
          p_experience_years: number;
          p_current_position: string | null;
          p_specialties: string[];
          p_employment_type: EmploymentType;
          p_job_change_intent: JobChangeIntent;
          p_desired_salary_range: SalaryBand;
          p_sns_links: SnsLink[];
          p_bio: string | null;
          p_visibility: ProfileVisibility;
          p_scout_enabled: boolean;
          p_avatar_path: string | null;
          p_value_priorities: string[];
        };
        Returns: Database["public"]["Tables"]["profiles"]["Row"];
      };
      save_salon_profile: {
        Args: {
          p_salon_name: string;
          p_prefecture: string;
          p_city: string | null;
          p_street_address: string | null;
          p_culture_description: string | null;
          p_employee_size_code: string | null;
          p_target_specialties: string[];
          p_instagram_handle: string | null;
          p_bio: string | null;
          p_visibility: ProfileVisibility;
          p_avatar_path: string | null;
          // 0014で追加。SQL側は default null のため、既存呼び出し元は
          // このプロパティを渡さなくても引き続き動作する。
          p_hotpepper_url?: string | null;
        };
        Returns: Database["public"]["Tables"]["profiles"]["Row"];
      };
      add_salon_photo: {
        // 0014で追加。caller=salon role・storage_pathの本人所有権・categoryの
        // 整合性はRPC内部（SQL側）で検証する。クライアントはstorage_pathの
        // 文字列を渡すのみ。
        Args: {
          p_category: SalonPhotoCategory;
          p_storage_path: string;
          p_sort_order: number;
        };
        Returns: Database["public"]["Tables"]["salon_photos"]["Row"];
      };
      update_salon_photo_sort_order: {
        // 0014で追加。並び順のみ更新可能（category/storage_pathは変更不可）。
        Args: {
          p_photo_id: string;
          p_sort_order: number;
        };
        Returns: Database["public"]["Tables"]["salon_photos"]["Row"];
      };
      delete_salon_photo: {
        // 0014で追加。DB行の削除のみ（Storageオブジェクト自体の削除は含まない）。
        Args: {
          p_photo_id: string;
        };
        Returns: undefined;
      };
      save_core_type_result: {
        // p_diagnosis_result_id のみ受け取る。matchScore等はRPCがSQL側で
        // 診断結果の生スコアから独自に再計算するため、クライアントから
        // 計算結果を渡すパラメータは存在しない。
        Args: {
          p_diagnosis_result_id: string;
        };
        Returns: Database["public"]["Tables"]["stylist_core_type_history"]["Row"];
      };
      save_salon_culture_profile: {
        // p_answersは選択肢コード・スライダー生値のみ。CultureAxisの数値化・
        // AI要約の生成はRPCがSQL側で行うため、計算結果を渡すパラメータは無い。
        Args: {
          p_status: SalonCultureStatus;
          p_respondent_role: SalonCultureRespondentRole | null;
          p_current_step: number;
          p_answers: Json;
          p_value_priorities: string[] | null;
          p_comment: string | null;
        };
        Returns: Database["public"]["Tables"]["salon_culture_profiles"]["Row"];
      };
      save_stylist_preference_profile: {
        // p_answersはq1〜q8の生の回答値(1〜5)のみ。0/25/50/75/100への変換は
        // RPCがSQL側で行うため、計算結果を渡すパラメータは無い。
        Args: {
          p_status: StylistPreferenceStatus;
          p_current_step: number;
          p_answers: Json;
        };
        Returns: Database["public"]["Tables"]["stylist_preference_profiles"]["Row"];
      };
      calculate_stylist_salon_match: {
        // 引数は対象サロンのuser_idのみ。呼び出し美容師自身はRPC内部で
        // auth.uid()から取得する（stylist_user_idは引数に取らない）。
        // 生のpreference_axes/culture_axesは返らず、計算済みスコアのみ。
        Args: {
          p_salon_user_id: string;
        };
        // 0011_stylist_salon_matching.sqlのjsonb_build_object()が実際に
        // 返すキー名と完全一致させている（available=false時はreasonのみ、
        // available=true時はoverall_score/axis_scoresのみを含むjsonbだが、
        // JSで存在しないキーへアクセスするとundefinedになるため、TS側では
        // 「常に4フィールドが存在し、該当しない場合はnull」という形で
        // 表現する）。
        Returns: {
          available: boolean;
          reason: string | null;
          overall_score: number | null;
          axis_scores: {
            education: number | null;
            challenge: number | null;
            personal_brand: number | null;
            collaboration: number | null;
            autonomy: number | null;
            work_flexibility: number | null;
            relationship_distance: number | null;
            hierarchy: number | null;
          } | null;
        };
      };
      calculate_salon_stylist_match: {
        // 0025で追加。引数は対象美容師のuser_idのみ。呼び出しサロン自身は
        // RPC内部でauth.uid()から取得する。0025で新設した内部専用関数
        // calculate_match_axes()に計算を委譲しており、同じペアであれば
        // calculate_stylist_salon_matchと完全に同じ戻り値になる
        // （数式・キー名は完全に共通のため、ここも同一のReturns shape）。
        Args: {
          p_stylist_user_id: string;
        };
        Returns: {
          available: boolean;
          reason: string | null;
          overall_score: number | null;
          axis_scores: {
            education: number | null;
            challenge: number | null;
            personal_brand: number | null;
            collaboration: number | null;
            autonomy: number | null;
            work_flexibility: number | null;
            relationship_distance: number | null;
            hierarchy: number | null;
          } | null;
        };
      };
      calculate_store_stylist_match: {
        // 0031で追加。calculate_salon_stylist_matchのstore版。アクセス権は
        // auth.uid()所有ではなくis_store_accessible(p_store_id)で判定する。
        // 計算元はsalon_store_culture_profiles（store単位）。Returns shapeは
        // calculate_salon_stylist_matchと完全に同一。
        Args: {
          p_store_id: string;
          p_stylist_user_id: string;
        };
        Returns: {
          available: boolean;
          reason: string | null;
          overall_score: number | null;
          axis_scores: {
            education: number | null;
            challenge: number | null;
            personal_brand: number | null;
            collaboration: number | null;
            autonomy: number | null;
            work_flexibility: number | null;
            relationship_distance: number | null;
            hierarchy: number | null;
          } | null;
        };
      };
      set_favorite_salon: {
        Args: { p_salon_user_id: string; p_favorite: boolean };
        Returns: boolean;
      };
      set_salon_interest: {
        Args: { p_salon_user_id: string; p_interested: boolean };
        Returns: boolean;
      };
      get_received_salon_interests: {
        Args: Record<string, never>;
        Returns: Array<{
          stylist_user_id: string;
          created_at: string;
          public_name: string | null;
          prefecture: string | null;
          desired_work_location: string | null;
          experience_years: number | null;
          current_position: string | null;
          specialties: string[];
          job_change_intent: JobChangeIntent;
          bio: string | null;
          match_profile: {
            primary_goal: string; secondary_goals: string[]; career_stage: string;
            wants_performance_offer: boolean;
            evidence_period_months: number | null; avg_monthly_technical_sales: number | null;
            avg_monthly_retail_sales: number | null; avg_monthly_clients: number | null;
            avg_monthly_named_clients: number | null; average_ticket: number | null;
            repeat_rate: number | null; monthly_working_days: number | null;
            average_daily_hours: number | null; self_acquired_clients: number | null;
            expected_transfer_clients: number | null; assistant_usage: string | null;
            verification_status: string; consistency_issues: string[];
            evidence_document_count: number;
          } | null;
        }>;
      };
      register_stylist_evidence_document: {
        Args: { p_document_type: string; p_storage_path: string; p_original_file_name: string };
        Returns: Database["public"]["Tables"]["stylist_evidence_documents"]["Row"];
      };
      delete_stylist_evidence_document: {
        Args: { p_document_id: string };
        Returns: string;
      };
      is_platform_admin: { Args: Record<string, never>; Returns: boolean };
      get_admin_evidence_queue: {
        Args: Record<string, never>;
        Returns: Array<{
          id: string; stylist_user_id: string; public_name: string | null;
          document_type: string; storage_path: string; original_file_name: string;
          review_status: string; review_reason: string | null; review_note: string | null;
          created_at: string; reviewed_at: string | null;
          declared_metrics: {
            evidence_period_months: number | null; avg_monthly_technical_sales: number | null;
            avg_monthly_clients: number | null; avg_monthly_named_clients: number | null;
            average_ticket: number | null; expected_transfer_clients: number | null;
          };
        }>;
      };
      review_stylist_evidence_document: {
        Args: { p_document_id: string; p_decision: string; p_reason: string; p_note: string | null };
        Returns: boolean;
      };
      save_stylist_match_profile: {
        Args: {
          p_primary_goal: string; p_secondary_goals: string[]; p_career_stage: string;
          p_evidence_period_months: number | null; p_avg_monthly_technical_sales: number | null;
          p_avg_monthly_retail_sales: number | null; p_avg_monthly_clients: number | null;
          p_avg_monthly_named_clients: number | null; p_average_ticket: number | null;
          p_repeat_rate: number | null; p_monthly_working_days: number | null;
          p_average_daily_hours: number | null; p_self_acquired_clients: number | null;
          p_expected_transfer_clients: number | null; p_assistant_usage: string | null;
        };
        Returns: Database["public"]["Tables"]["stylist_match_profiles"]["Row"];
      };
      save_stylist_match_profile_v2: {
        Args: {
          p_primary_goal: string; p_secondary_goals: string[]; p_career_stage: string;
          p_wants_performance_offer: boolean;
          p_evidence_period_months: number | null; p_avg_monthly_technical_sales: number | null;
          p_avg_monthly_retail_sales: number | null; p_avg_monthly_clients: number | null;
          p_avg_monthly_named_clients: number | null; p_average_ticket: number | null;
          p_repeat_rate: number | null; p_monthly_working_days: number | null;
          p_average_daily_hours: number | null; p_self_acquired_clients: number | null;
          p_expected_transfer_clients: number | null; p_assistant_usage: string | null;
        };
        Returns: Database["public"]["Tables"]["stylist_match_profiles"]["Row"];
      };
      create_salary_offer: {
        Args: {
          p_stylist_user_id: string; p_monthly_guarantee: number; p_performance_addition: number;
          p_guarantee_months: number; p_performance_condition: string | null; p_salon_message: string | null;
        };
        Returns: Database["public"]["Tables"]["salary_offers"]["Row"];
      };
      create_salary_offer_v2: {
        // 0035で追加。store単位給与オファー作成。アクセス権はis_store_accessible(p_store_id)、
        // Interest確認はstore_id単位。evidence/verification条件は旧create_salary_offerと同一。
        Args: {
          p_store_id: string; p_stylist_user_id: string; p_monthly_guarantee: number;
          p_performance_addition: number; p_guarantee_months: number;
          p_performance_condition: string | null; p_salon_message: string | null;
        };
        Returns: Database["public"]["Tables"]["salary_offers"]["Row"];
      };
      set_store_interest: {
        // 0035で追加。store単位「話を聞いてみたい」の送信・取消。salon_user_idは渡さない。
        Args: { p_store_id: string; p_interested: boolean };
        Returns: boolean;
      };
      calculate_stylist_store_match: {
        // 0031で追加。美容師→店舗のmatching。Returns shapeは
        // calculate_stylist_salon_matchと完全に同一。
        Args: { p_store_id: string };
        Returns: Database["public"]["Functions"]["calculate_store_stylist_match"]["Returns"];
      };
      get_public_salon_stores: {
        // 0036で追加。美容師向けPUBLIC店舗一覧（visibility=PUBLICのみ）。
        Args: Record<string, never>;
        Returns: Array<{
          store_id: string; organization_id: string; store_name: string;
          prefecture: string | null; city: string | null;
          employee_size_code: string | null; target_specialties: string[];
          bio: string | null;
        }>;
      };
      get_public_salon_store_detail: {
        // 0036で追加。美容師向けPUBLIC店舗詳細。PUBLICでない場合はRPCが例外を返す。
        // cultureはstatus=completedの場合のみ非null。
        Args: { p_store_id: string };
        Returns: {
          available: boolean; store_id: string; organization_id: string; store_name: string;
          prefecture: string | null; city: string | null; street_address: string | null;
          culture_description: string | null; employee_size_code: string | null;
          target_specialties: string[]; bio: string | null; hotpepper_url: string | null;
          culture: {
            culture_profile_id: string;
            culture_axes: SalonCultureAxes | null;
            value_priorities: string[] | null;
            comment: string | null;
            ai_summary: string | null;
          } | null;
        };
      };
      get_store_received_interests: {
        // 0036で追加。store単位Interest受信一覧。match は calculate_match_axes_by_store の結果
        // （calculate_store_stylist_matchと同一shape）。
        Args: { p_store_id: string };
        Returns: Array<{
          interest_id: string; stylist_user_id: string; store_id: string; created_at: string;
          public_name: string | null; prefecture: string | null;
          desired_work_location: string | null; experience_years: number | null;
          current_position: string | null; specialties: string[];
          job_change_intent: JobChangeIntent; bio: string | null;
          match: Database["public"]["Functions"]["calculate_store_stylist_match"]["Returns"];
          match_profile: {
            primary_goal: string; secondary_goals: string[]; career_stage: string;
            wants_performance_offer: boolean;
            evidence_period_months: number | null; avg_monthly_technical_sales: number | null;
            avg_monthly_retail_sales: number | null; avg_monthly_clients: number | null;
            avg_monthly_named_clients: number | null; average_ticket: number | null;
            repeat_rate: number | null; monthly_working_days: number | null;
            average_daily_hours: number | null; self_acquired_clients: number | null;
            expected_transfer_clients: number | null; assistant_usage: string | null;
            verification_status: string; consistency_issues: string[];
            evidence_document_count: number;
          } | null;
        }>;
      };
      get_store_scouts: {
        // 0036で追加。store単位Scout履歴（同一storeにアクセスできる全staff分）。
        Args: { p_store_id: string };
        Returns: Array<{
          id: string; store_id: string | null; created_by_user_id: string | null;
          stylist_user_id: string; message: string; template_type: string | null;
          matching_score: number | null; read_status: string; response_status: string;
          response_message: string | null; sent_at: string; read_at: string | null;
          responded_at: string | null; created_at: string;
        }>;
      };
      get_store_salary_offers: {
        // 0036で追加。store単位Salary Offer履歴（同一storeにアクセスできる全staff分）。
        Args: { p_store_id: string };
        Returns: Array<{
          id: string; store_id: string | null; created_by_user_id: string | null;
          stylist_user_id: string; monthly_guarantee: number; performance_addition: number;
          guarantee_months: number; performance_condition: string | null;
          salon_message: string | null; status: string; response_reason: string | null;
          response_note: string | null; responded_at: string | null;
          created_at: string; updated_at: string;
        }>;
      };
      add_hiring_candidate: {
        // 0037で追加。「採用進捗に追加」（書き込み権限=can_manage_store_hiring）。
        Args: { p_store_id: string; p_stylist_user_id: string; p_internal_note?: string | null };
        Returns: { id: string; status: string; source: string };
      };
      schedule_hiring_interview: {
        // 0037で追加。面談の登録・日時変更。
        Args: {
          p_process_id: string; p_interview_at: string; p_interview_type: string;
          p_location?: string | null; p_candidate_message?: string | null; p_internal_note?: string | null;
        };
        Returns: { id: string; status: string; interview_at: string };
      };
      update_hiring_status: {
        // 0037で追加。面談予定以外のステータス変更。
        Args: {
          p_process_id: string; p_to_status: string; p_public_note?: string | null;
          p_internal_note?: string | null; p_reason_code?: string | null; p_reason_note?: string | null;
        };
        Returns: { id: string; status: string };
      };
      update_hiring_internal_note: {
        // 0037で追加。社内メモの更新（店舗側のみ）。
        Args: { p_process_id: string; p_internal_note: string | null };
        Returns: { id: string };
      };
      get_company_hiring_period_analytics: {
        // 0042で追加。活動ベース：期間内に初めて各段階へ到達した人数。p_from <= created_at < p_to。
        Args: { p_from: string; p_to: string; p_organization_id?: string | null };
        Returns: {
          period_from: string; period_to: string;
          activity: {
            added_count: number; interview_reached_count: number; interview_completed_count: number;
            selection_count: number; offered_count: number; hired_count: number;
            declined_count: number; rejected_count: number;
          };
          by_source: Array<{
            source: string; added_count: number; interview_reached_count: number;
            interview_completed_count: number; offered_count: number; hired_count: number;
          }>;
          by_store: Array<{
            store_id: string; store_name: string; organization_id: string; organization_name: string;
            added_count: number; interview_reached_count: number; interview_completed_count: number;
            selection_count: number; offered_count: number; hired_count: number;
            declined_count: number; rejected_count: number;
          }>;
          unknown_dates: { no_candidate_added_count: number; no_events_count: number };
        };
      };
      get_company_hiring_cohort_analytics: {
        // 0042で追加。候補者獲得コホート：期間内に候補追加された人の、現在までの到達結果。
        Args: { p_from: string; p_to: string; p_organization_id?: string | null };
        Returns: {
          period_from: string; period_to: string;
          cohort: {
            candidate_count: number; interview_reached_count: number; interview_completed_count: number;
            selection_count: number; offered_count: number; hired_count: number;
            declined_count: number; rejected_count: number;
          };
          by_source: Array<{
            source: string; candidate_count: number; interview_reached_count: number;
            interview_completed_count: number; offered_count: number; hired_count: number;
          }>;
          by_store: Array<{
            store_id: string; store_name: string; organization_id: string; organization_name: string;
            candidate_count: number; interview_reached_count: number; interview_completed_count: number;
            selection_count: number; offered_count: number; hired_count: number;
            declined_count: number; rejected_count: number;
          }>;
          unknown_dates: { cohort_date_unknown_count: number };
        };
      };
      get_admin_organization_stores: {
        // 0042で追加。運営者のみ。店舗の基本情報と採用の件数だけ（内部メモ等は返らない）。
        Args: { p_organization_id: string };
        Returns: Array<{
          store_id: string; store_name: string; usage_status: string; created_at: string;
          candidate_count: number; active_candidate_count: number; hired_count: number;
          latest_activity_at: string | null;
        }>;
      };
      get_admin_organization_overview: {
        // 0041で追加。運営者のみ・読み取り専用。全社サマリー（採用は現在の所属会社、請求は成立時に固定した会社で集計）。
        Args: Record<string, never>;
        Returns: Array<{
          organization_id: string; organization_name: string;
          store_count: number; active_store_count: number;
          candidate_count: number; interview_count: number; offered_count: number; hired_count: number;
          latest_hired_at: string | null; latest_activity_at: string | null;
          success_fee_count: number; pending_confirmation_count: number; confirmed_count: number;
          invoiced_count: number; paid_count: number; waived_count: number; cancelled_count: number;
          confirmed_total_amount: number; invoiced_total_amount: number; paid_total_amount: number;
        }>;
      };
      get_company_hiring_analytics: {
        // 0041で追加。会社の履歴ベース採用分析（到達ステージ）。company_owner/admin/recruiting_adminは全店舗、area_managerは担当店舗。
        Args: { p_organization_id?: string | null };
        Returns: {
          total: {
            candidate_count: number; interview_reached_count: number; interview_completed_count: number;
            selection_count: number; offered_count: number; hired_count: number;
            declined_count: number; rejected_count: number;
          };
          by_source: Array<{
            source: string; candidate_count: number; interview_reached_count: number;
            interview_completed_count: number; offered_count: number; hired_count: number;
          }>;
          by_store: Array<{
            store_id: string; store_name: string; organization_id: string; organization_name: string;
            candidate_count: number; interview_reached_count: number; interview_completed_count: number;
            selection_count: number; offered_count: number; hired_count: number;
            declined_count: number; rejected_count: number;
          }>;
          attention: Array<{
            process_id: string; store_id: string; store_name: string; stylist_name: string | null;
            status: string; updated_at: string; interview_at: string | null;
          }>;
        };
      };
      get_admin_billing_integrity_issues: {
        // 0040で追加。運営者のみ・読み取り専用。採用成立と成功報酬の不整合を返す（空配列=問題なし）。
        Args: Record<string, never>;
        Returns: Array<{
          issue_type: string; severity: string;
          hiring_process_id: string; success_fee_id: string | null;
          organization_id: string; store_id: string; store_name: string | null;
          stylist_name: string | null; hired_at: string | null; message: string;
        }>;
      };
      get_admin_success_fees: {
        // 0039で追加。運営者(platform admin)のみ。成功報酬の一覧（運営者メモを含む）。
        Args: { p_status?: string | null };
        Returns: Array<{
          fee_id: string; hiring_process_id: string;
          organization_id: string; organization_name: string | null;
          store_id: string; store_name: string;
          stylist_user_id: string; stylist_name: string | null;
          hired_at: string; fee_status: string; currency: string;
          fee_amount: number | null; tax_amount: number | null; total_amount: number | null;
          confirmed_at: string | null; invoiced_at: string | null; paid_at: string | null;
          waived_at: string | null; cancelled_at: string | null;
          note: string | null; created_at: string; updated_at: string;
          // 0043で追加。採用成立時点の契約snapshot。0043より前のレコードはすべてnull（未記録）。
          contract_success_fee_amount: number | null; contract_success_fee_mode: string | null;
          contract_status_snapshot: string | null; contract_snapshot_at: string | null;
          contract_snapshot_event_id: string | null;
        }>;
      };
      admin_update_success_fee: {
        // 0039で追加。運営者のみ。p_action: confirm / invoice / paid / waive / cancel。
        Args: {
          p_fee_id: string; p_action: string;
          p_fee_amount?: number | null; p_tax_amount?: number | null; p_note?: string | null;
        };
        Returns: {
          fee_id: string; fee_status: string;
          fee_amount: number | null; tax_amount: number | null; total_amount: number | null;
        };
      };
      get_company_success_fees: {
        // 0039で追加。自社のcompany_owner/company_adminのみ。運営者メモ・user idは返らない。
        Args: { p_organization_id?: string | null };
        Returns: Array<{
          fee_id: string; hiring_process_id: string; organization_id: string;
          store_id: string; store_name: string; stylist_name: string | null;
          hired_at: string; fee_status: string; currency: string;
          fee_amount: number | null; tax_amount: number | null; total_amount: number | null;
          confirmed_at: string | null; invoiced_at: string | null; paid_at: string | null;
          waived_at: string | null; cancelled_at: string | null;
          created_at: string; updated_at: string;
          // 0043で追加。契約snapshot（event idは会社側には返らない）。
          contract_success_fee_amount: number | null; contract_success_fee_mode: string | null;
          contract_status_snapshot: string | null; contract_snapshot_at: string | null;
        }>;
      };
      get_admin_organization_contracts: {
        // 0043で追加。運営者のみ。全社の契約条件（内部メモ・操作者idは返らない）。契約未設定の会社は contract が null。
        Args: Record<string, never>;
        Returns: Array<{
          organization_id: string; organization_name: string; fiscal_year_start_month: number;
          contract: {
            contract_status: string; success_fee_mode: string; success_fee_amount: number | null;
            currency: string; monthly_fee: number | null;
            contract_started_at: string | null; contract_ended_at: string | null; updated_at: string;
          } | null;
        }>;
      };
      get_admin_organization_contract: {
        // 0043で追加。運営者のみ。1社の契約条件（内部メモ含む）と変更履歴（最大100件、新しい順）。
        Args: { p_organization_id: string };
        Returns: {
          organization_id: string; organization_name: string; fiscal_year_start_month: number;
          contract: {
            contract_status: string; success_fee_mode: string; success_fee_amount: number | null;
            currency: string; monthly_fee: number | null;
            contract_started_at: string | null; contract_ended_at: string | null;
            note: string | null; created_at: string; updated_at: string;
          } | null;
          events: Array<{
            event_type: string;
            before_values: Record<string, string | number | boolean | null>;
            after_values: Record<string, string | number | boolean | null>;
            actor_user_id: string | null; note: string | null; created_at: string;
          }>;
        };
      };
      admin_update_organization_contract: {
        // 0043で追加。運営者のみ。p_changes は変更する項目だけ（キーがある項目だけ変更、nullは空にする）。
        Args: {
          p_organization_id: string;
          p_changes: Record<string, string | number | null>;
          p_reason?: string | null;
        };
        Returns: {
          changed: boolean; organization_id: string; fiscal_year_start_month: number;
          contract_status: string | null; success_fee_amount: number | null; monthly_fee: number | null;
        };
      };
      get_company_contract_settings: {
        // 0043で追加。自社のcompany_owner/company_adminのみ。内部メモ・履歴・操作者idは返らない。
        Args: { p_organization_id?: string | null };
        Returns: Array<{
          organization_id: string; organization_name: string; fiscal_year_start_month: number;
          has_contract: boolean; contract_status: string | null; success_fee_mode: string | null;
          success_fee_amount: number | null; currency: string | null; monthly_fee: number | null;
          contract_started_at: string | null; contract_ended_at: string | null; updated_at: string | null;
        }>;
      };
      get_store_hiring_processes: {
        // 0037で追加。店舗の採用進捗一覧（閲覧: is_store_accessible）。internal_note/reason_*を含む（店舗側専用）。
        Args: { p_store_id: string };
        Returns: Array<{
          process_id: string; store_id: string; stylist_user_id: string;
          public_name: string | null; prefecture: string | null;
          current_position: string | null; experience_years: number | null;
          match: Database["public"]["Functions"]["calculate_store_stylist_match"]["Returns"];
          status: string; source: string;
          interview_at: string | null; interview_type: string | null; interview_location: string | null;
          candidate_message: string | null; internal_note: string | null;
          declined_by: string | null; reason_code: string | null; reason_note: string | null;
          hired_at: string | null; closed_at: string | null; created_at: string; updated_at: string;
        }>;
      };
      get_hiring_process_events: {
        // 0037で追加。履歴（店舗側。社内メモ・理由を含む）。
        Args: { p_process_id: string };
        Returns: Array<{
          id: string; event_type: string; from_status: string | null; to_status: string | null;
          actor_kind: string; is_me: boolean; interview_at: string | null;
          public_note: string | null; internal_note: string | null; reason_code: string | null;
          created_at: string;
        }>;
      };
      get_my_hiring_processes: {
        // 0037で追加。美容師本人の進捗。internal_note/reason_*/スタッフIDは含まれない。
        Args: Record<string, never>;
        Returns: Array<{
          process_id: string; store_id: string; store_name: string;
          prefecture: string | null; city: string | null; store_is_public: boolean;
          status: string; interview_at: string | null; interview_type: string | null;
          interview_location: string | null; candidate_message: string | null;
          declined_by: string | null; hired_at: string | null; closed_at: string | null;
          created_at: string; updated_at: string;
          events: Array<{
            event_type: string; to_status: string | null; actor_kind: string;
            interview_at: string | null; public_note: string | null; created_at: string;
          }>;
        }>;
      };
      decline_hiring_process: {
        // 0037で追加。美容師が自分の進捗を辞退する。
        Args: { p_process_id: string; p_public_note?: string | null };
        Returns: { id: string; status: string };
      };
      get_store_scout_quota: {
        // 0036で追加。store→organizationのScout残数（読み取り専用）。
        Args: { p_store_id: string };
        Returns: {
          monthly_free_limit: number; additional_credits: number;
          used_this_month: number; remaining: number;
        };
      };
      respond_salary_offer: {
        Args: { p_offer_id: string; p_response: string; p_reason: string | null; p_note: string | null };
        Returns: Database["public"]["Tables"]["salary_offers"]["Row"];
      };
      get_public_stylists_for_scout: {
        // 0025で追加。引数なし（呼び出しサロン自身はRPC内部でauth.uid()から
        // 取得する）。対象条件（role=stylist・visibility=PUBLIC・
        // scout_enabled）を満たす美容師を、matchの相性が高い順に返す。
        // matchはcalculate_stylist_salon_match/calculate_salon_stylist_matchと
        // 同じReturns shape（内部で共通のcalculate_match_axes()を使うため）。
        Args: Record<string, never>;
        Returns: Array<{
          stylist_user_id: string;
          public_name: string | null;
          prefecture: string | null;
          desired_work_location: string | null;
          experience_years: number | null;
          current_position: string | null;
          specialties: string[];
          job_change_intent: JobChangeIntent;
          bio: string | null;
          match: {
            available: boolean;
            reason: string | null;
            overall_score: number | null;
            axis_scores: {
              education: number | null;
              challenge: number | null;
              personal_brand: number | null;
              collaboration: number | null;
              autonomy: number | null;
              work_flexibility: number | null;
              relationship_distance: number | null;
              hierarchy: number | null;
            } | null;
          };
          previous_interest_at: string | null;
          previous_scout_count: number;
          previous_scout_last_sent_at: string | null;
        }>;
      };
      send_scout: {
        // 0025で追加。role guard・対象確認・scout_enabled確認・月間枠チェック・
        // matching_score算出はすべてRPC内部（SQL側）で行う。再スカウトも
        // 常に新しい行としてinsertされる（unique制約なし）。
        Args: {
          p_stylist_user_id: string;
          p_message: string;
          p_template_type: string | null;
        };
        Returns: Database["public"]["Tables"]["scouts"]["Row"];
      };
      send_scout_v2: {
        // 0034で追加。store単位Scout送信。quotaはorganization_scout_quotas
        // （会社単位）。アクセス権はis_store_accessible(p_store_id)で判定。
        Args: {
          p_store_id: string;
          p_stylist_user_id: string;
          p_message: string;
          p_template_type: string | null;
        };
        Returns: Database["public"]["Tables"]["scouts"]["Row"];
      };
      mark_scout_read: {
        Args: { p_scout_id: string };
        Returns: Database["public"]["Tables"]["scouts"]["Row"];
      };
      respond_scout: {
        Args: { p_scout_id: string; p_response: string; p_response_message: string | null };
        Returns: Database["public"]["Tables"]["scouts"]["Row"];
      };
      mark_notification_read: {
        Args: { p_notification_id: string };
        Returns: Database["public"]["Tables"]["notifications"]["Row"];
      };
      mark_all_notifications_read: {
        Args: Record<string, never>;
        Returns: number;
      };
      mark_notifications_read_by_entities: {
        // p_entitiesは [{type: string, id: string}, ...] のJSON配列。
        Args: { p_entities: { type: string; id: string }[] };
        Returns: number;
      };
      get_public_salon_culture_detail: {
        // 引数は対象サロンのuser_idのみ。呼び出し美容師自身はRPC内部で
        // auth.uid()から取得する（stylist_user_idは引数に取らない）。
        // 0013_get_public_salon_culture_detail.sqlのjsonb_build_object()と
        // 完全一致させている。available=false時はreasonのみ、available=true
        // 時はculture_profile_id/culture_axes/value_priorities/comment/aiを
        // 含む。JSで存在しないキーへアクセスするとundefinedになるため、
        // TS側では「常に全フィールドが存在し、該当しない場合はnull」という
        // 形で表現する。
        Args: {
          p_salon_user_id: string;
        };
        Returns: {
          available: boolean;
          reason: string | null;
          culture_profile_id: string | null;
          culture_axes: SalonCultureAxes | null;
          value_priorities: string[] | null;
          comment: string | null;
          ai: {
            essence: string | null;
            explanation: string | null;
            advice: string[] | null;
            growth: string | null;
          } | null;
        };
      };
      get_public_salon_links: {
        // 0015で追加。引数は対象サロンのuser_idのみ。呼び出し美容師自身は
        // RPC内部でauth.uid()から取得する。jsonb_agg()の結果（0件なら空配列）
        // をそのまま返す。
        Args: {
          p_salon_user_id: string;
        };
        Returns: Array<{
          id: string;
          link_type: SalonLinkType;
          label: string | null;
          url: string;
          sort_order: number;
        }>;
      };
      get_public_salon_photos: {
        // 0015で追加。引数は対象サロンのuser_idのみ。id/category/storage_path/
        // sort_orderのみを返す（回答内容等の生データは含まない）。
        // signed URL発行はNext.js側（呼び出し元）が行う。
        Args: {
          p_salon_user_id: string;
        };
        Returns: Array<{
          id: string;
          category: SalonPhotoCategory;
          storage_path: string;
          sort_order: number;
        }>;
      };
      create_ai_output: {
        Args: {
          p_diagnosis_result_id: string;
          p_output_type: AiOutputType;
          p_provider: string;
          p_model: string;
          p_prompt_version: string;
          p_response: Json;
        };
        Returns: Database["public"]["Tables"]["diagnosis_ai_outputs"]["Row"];
      };
      activate_ai_output: {
        Args: {
          p_ai_output_id: string;
        };
        Returns: Database["public"]["Tables"]["diagnosis_ai_outputs"]["Row"];
      };
      create_salon_culture_ai_output: {
        Args: {
          p_salon_culture_profile_id: string;
          p_output_type: AiOutputType;
          p_provider: string;
          p_model: string;
          p_prompt_version: string;
          p_response: Json;
        };
        Returns: Database["public"]["Tables"]["salon_culture_ai_outputs"]["Row"];
      };
      activate_salon_culture_ai_output: {
        Args: {
          p_ai_output_id: string;
        };
        Returns: Database["public"]["Tables"]["salon_culture_ai_outputs"]["Row"];
      };
      start_pending_diagnosis_claim: {
        Args: {
          p_claim_token: string;
        };
        Returns: Database["public"]["Tables"]["pending_diagnoses"]["Row"];
      };
      complete_pending_diagnosis_claim: {
        Args: {
          p_pending_id: string;
        };
        Returns: Database["public"]["Tables"]["pending_diagnoses"]["Row"];
      };
      set_diagnosis_ai_status: {
        Args: {
          p_diagnosis_result_id: string;
          p_status: AiGenerationStatus;
        };
        Returns: Database["public"]["Tables"]["diagnosis_results"]["Row"];
      };
      cleanup_expired_pending_diagnoses: {
        Args: Record<string, never>;
        Returns: number;
      };
      save_salon_store_profile: {
        // 0030で追加。法人・複数店舗対応Phase 3B。店舗単位プロフィール保存の
        // 唯一の経路。認可はis_store_accessible(p_store_id)のみで判定する。
        Args: {
          p_store_id: string;
          p_salon_name: string;
          p_visibility: ProfileVisibility;
          p_prefecture: string;
          p_city: string | null;
          p_street_address: string | null;
          p_culture_description: string | null;
          p_employee_size_code: string | null;
          p_target_specialties: string[];
          p_bio: string | null;
          p_hotpepper_url?: string | null;
        };
        Returns: Database["public"]["Tables"]["salon_store_profiles"]["Row"];
      };
      save_salon_store_culture_profile: {
        // 0030で追加。法人・複数店舗対応Phase 3B。店舗単位「サロンらしさ」
        // 12軸診断保存の唯一の経路。p_answersは選択肢コード(1〜5)のみ。
        // culture_axesの数値化・ai_summary生成はRPCがSQL側で行う。
        Args: {
          p_store_id: string;
          p_status: SalonCultureStatus;
          p_respondent_role: SalonCultureRespondentRole | null;
          p_current_step: number;
          p_answers: Json;
          p_value_priorities: string[] | null;
          p_comment: string | null;
        };
        Returns: Database["public"]["Tables"]["salon_store_culture_profiles"]["Row"];
      };
    };
    Enums: {
      user_role: UserRole; gender_type: GenderType; age_band: AgeBand;
      employment_type: EmploymentType; job_change_intent: JobChangeIntent;
      salary_band: SalaryBand; diagnosis_mode: DiagnosisModeDb;
      profile_visibility: ProfileVisibility; ai_output_type: AiOutputType;
      pending_diagnosis_claim_status: PendingDiagnosisClaimStatus;
      ai_generation_status: AiGenerationStatus;
      account_recovery_account_type: AccountRecoveryAccountType;
      account_recovery_status: AccountRecoveryStatus;
      stylist_core_type: StylistCoreType;
      salon_culture_respondent_role: SalonCultureRespondentRole;
      salon_culture_status: SalonCultureStatus;
      stylist_preference_status: StylistPreferenceStatus;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};
