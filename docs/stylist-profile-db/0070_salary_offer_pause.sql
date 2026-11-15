-- 給与条件の新規提示を（再）停止する。既存の提示・履歴には触れない。
insert into public.feature_pauses (feature, paused, reason)
values ('salary_offer_presentation', true, '給与条件の提示は一時停止中（既存の提示・履歴は保持）')
on conflict (feature) do update set paused = true, reason = excluded.reason, updated_at = now();
