-- 草案・未適用。本番へは承認なしに実行しない。責任者の操作として、2026-11-27の決定を設定に記録するだけ（自動請求は有効にしない）。
-- 前提: 0109 適用済みの環境。auto_charge_enabled は他の未決定項目（再試行方針・カード未登録時の扱い）が決定済みになるまで有効にできない。
select public.admin_billing_setting_set('hire_fee_role_source', 'operator_confirmed_registration_class', 'decided');
-- 値の意味: 運営が入社意思確認の時に本人へ確認した登録区分（スタイリスト/アシスタント）を入力する。担当業務では決めない。
-- 確認: select key, value, status from public.billing_settings where key in ('hire_fee_role_source','auto_charge_enabled');  -- auto_charge_enabled は false のまま
