# 地域検索 v2（隣接データ）
- `prefecture_adjacency_official88.tsv`: 国土数値情報(N03 20260101)の共有境界から機械生成した、都道府県の隣接88組（無向）。公式データは保持する（DBの prefecture_adjacency に両方向で入れる草案は別管理・未適用）。
- `near_search_eligible=false` は2組だけ: 岡山–香川(33–37)、広島–愛媛(34–38)。離島内の県境のみで接するため、近隣検索の対象外（地域指定・全国検索では利用できる）。理由は必須（DBの制約）。
- 山口–福岡(35–40)は陸上の境界を共有しないため追加しない。
- 検査: `tests/area-adjacency-data.test.ts`。
