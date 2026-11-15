-- 0072 の巻き戻し（草案・未適用）。専用の保存関数を削除するだけ。データ（保存済みの value_priorities）には触れない。
-- アプリ側は、この関数が無い場合は保存しない（一時停止の表示のまま）。
begin;
set local lock_timeout = '15s';
drop function if exists public.set_stylist_value_priorities(text[]);
commit;
