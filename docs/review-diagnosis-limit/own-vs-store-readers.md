# 自分用（salon_culture_profiles）と店舗用（salon_store_culture_profiles）: どこが何を読むか

現行コード（ブランチ claude/beauty-reach-handover-rugtww の HEAD）から数えた一覧。**旧マッチングの参照先は変更していない**。
「会社ページ→店舗ページ」への再構成の判断材料であり、ここでは何も変更しない。

## 1. 読み手の一覧

| 画面・機能 | 読むテーブル | 根拠（コード／関数） |
|---|---|---|
| サロン マイページ（自分の結果の表示・AI解説の表示） | **自分用** salon_culture_profiles（本人の行） | app/salon/mypage/page.tsx（`from("salon_culture_profiles")`。コメントにも「店舗単位の結果とは混ぜない」と明記） |
| サロン 自分用の診断・結果・分析の各画面 | **自分用** | app/salon/culture/page.tsx, culture/result, culture/analysis |
| 自分用AI解説の生成 | **自分用** | lib/salon-culture/run-culture-ai-job.ts, ai-retry.ts, lib/ai/generate-salon-culture-narrative.ts |
| 店舗ごとの診断・結果・分析の各画面（サロン側） | **店舗用** salon_store_culture_profiles | app/salon/stores/[storeId]/culture/**（`from("salon_store_culture_profiles")`） |
| 店舗プレビュー（サロン側が見る、公開時の見え方） | **店舗用** | lib/store-preview/load.ts |
| **美容師向けの表示**: サロン一覧・詳細（文化・マッチ度） | **店舗用** | app/stylist/salons/page.tsx, app/stylist/salons/[storeId]/page.tsx → `get_public_salon_stores` / `get_public_salon_store_detail`（0036: salon_store_culture_profiles を参照） |
| 美容師の受信箱（スカウト・サロン表示） | **店舗用** | lib/stylist-inbox/load.ts → `get_public_salon_stores` |
| **マッチング（美容師→店舗）** | **店舗用** | `calculate_stylist_store_match` → `calculate_match_axes_by_store`（0031: `salon_store_culture_profiles where store_id = p_store_id`）。呼び出し: app/stylist/salons/** |
| **マッチング（店舗→美容師。サロン側の美容師一覧）** | **店舗用** | `calculate_store_stylist_match`（0031）。呼び出し: app/salon/stores/[storeId]/stylists/page.tsx |
| 旧マッチング `calculate_stylist_salon_match`（0011→0025） | **自分用** | 関数定義は残っている（`salon_culture_profiles where salon_user_id`）。**現行の app/lib からの呼び出しは lib/matching/actions.ts の定義だけで、画面からは呼ばれていない**（grep で確認）。参照先は変更しない |
| 旧公開文化詳細 `get_public_salon_culture_detail`（0013） | **自分用** | 同上。関数は残るが、現行画面からは呼ばれていない |

まとめ: **サロンのオーナー本人が見る「マイページ」だけが自分用、美容師に見える表示とマッチングはすべて店舗用**。旧RPC（自分用を読む）は残っているが、現行アプリの画面は使っていない（旧版アプリ・直接のAPI呼び出しは別）。

## 2. 方針と、同期スキップが「整合の解決」ではない理由

- 方針（維持）: 確定済みの**自分の結果**を、店舗の保存で上書きしない。
- 初回店舗→本人行の同期（0030 `save_salon_store_culture_profile`）は、今は本人行を無条件に upsert する。0058 では、本人行が確定済みならこの同期を**スキップ**し、未作成・未確定なら初期状態つきで作る。
- ただし、スキップは「上書きしない」だけで、次の食い違いを残す。
  - 本人行が確定済みで、初回店舗が別の結果を確定した場合: **マイページ（自分用）は古い結果、美容師の表示とマッチング（店舗用）は新しい結果**になる。
  - 逆に、店舗の確定後にオーナー本人が自分用を再診断した場合: 店舗用は変わらず、自分用だけが変わる。
- つまり「どちらが正か」は決まらない。再構成（会社ページ→店舗ページ）で、**マイページの表示元をどちらにするか／自分用を残すか**を決めるまでは、食い違いは仕様として残る。今回は表示元もマッチングの参照先も変えていない。
- 再構成・スタッフ経由の変更は、別の変更として管理する。
