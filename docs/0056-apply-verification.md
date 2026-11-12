# 0056 適用状況と照合の記録

## 経緯
- 2026-11-12 14:05 JST: オーナーが Supabase で 0056 を実行（結果表示: Success. No rows returned）。0056 は再実行していない。
- 同日: 読み取り専用SQLによる構造確認（表・RLS・ポリシー・権限・関数・外部キーの動作・インデックス・制約・行数0）。オーナー報告では全項目が通った。
- リポジトリには 6b281c4（0056 のSQLのみ）、0fc2012（アプリ側）の順でコミット・プッシュ済み。

## 訂正
- 6b281c4 のコミットメッセージにある「実行済みの内容は検証済みの最終版と同一」という趣旨の記述、および報告での
  「一字一句同じ」は、本番にある関数の中身を確認できていない時点の記述であり、確認済みの事実ではない。
- 確認できているのは「構造が想定どおり」であること。SQL文面の一致は、下記の照合が済むまで「一致した」とは扱わない。
- コミット履歴は書き換えない（この記録で訂正する）。

## 関数本体（prosrc）の照合（読み取り専用）
検証済みのローカル版（リポジトリのファイルから作成した検証DB）の値:

| 関数名 | body_md5 | body_length |
|---|---|---|
| _salon_analysis_base_snapshot | 86eb0953b40cb5a9b7d61b72d5bbd580 | 821 |
| _salon_analysis_normalize_answers | 6a1b4de1ddcde66b88820c7c453543fa | 1369 |
| can_edit_store_culture_analysis | 282abd0b6f042f726dcf76f5f0140c55 | 81 |
| save_salon_culture_analysis_answers | 3a81836694782c42da04363606238b7d | 1604 |
| save_salon_store_culture_analysis_answers | ae3449ed93bd6d56cba82d3ee3953375 | 1852 |

本番での照合結果: 未回収（オーナーが次のSQLを実行して結果を共有するまで「一致」とは扱わない）。

```sql
select proname, md5(prosrc) as body_md5, length(prosrc) as body_length
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and proname in ('_salon_analysis_normalize_answers','_salon_analysis_base_snapshot',
                  'can_edit_store_culture_analysis','save_salon_culture_analysis_answers',
                  'save_salon_store_culture_analysis_answers')
order by proname;
```

表・制約・インデックスの文面一致は、この照合では確かめられない（構造確認のみ）。
