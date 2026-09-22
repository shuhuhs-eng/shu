# Phase 1: 美容師オンボーディング 詳細設計（実装直前・最終確認）

`docs/requirements-v1.0.md`（Version 1.0 Final）3.1節の具体化。**この内容の確認・承認をもって実装に着手する。**

---

## 1. 画面構成の方針

- **新規に複数のルートを作らず、既存の`/onboarding`を1つの多段ウィザードに再構成する。** 既存の「診断クイズ」（`/diagnosis/stylist`）と同じ、1画面内でクライアント側の状態（ステップ番号）を進める方式を踏襲する
- **DBへの書き込みは最終ステップでの1回のみ**とし、既存の`save_stylist_profile()` RPCをそのまま使う（各ステップごとの部分保存は行わない）。途中のステップ内容はブラウザ内の状態としてのみ保持し、離脱すると失われる（既存の単一フォームと同じ挙動であり、後退ではない）
- **`profiles.onboarding_step`の意味は変更しない。** 保存成功時に`greatest(onboarding_step, 4)`でCOMPLETEにする既存ロジックをそのまま使う。ステップ数（4ステップ）はUI上の見せ方の変更であり、DBの進捗値の粒度を4段階に合わせて変更するものではない（要件定義書10.13節のとおり、既存ユーザーは完了扱いのまま）
- **保存成功後の遷移先を `/` から `/mypage` に変更する**（要件定義書3.1節「⑤保存→⑥マイページ」に合わせるため）。これは既存動作からの変更点として明記する
- **`/profile/edit`（既存の編集画面）はステップ化せず、現状の単一フォームのまま変更しない**（要件定義書10.13節のとおり）

---

## 2. 画面一覧

| # | 画面/状態 | 内容 |
|---|---|---|
| 1 | `/onboarding`（ステップ1） | 基本情報 |
| 2 | `/onboarding`（ステップ2） | キャリア |
| 3 | `/onboarding`（ステップ3） | 希望条件 |
| 4 | `/onboarding`（ステップ4） | 働き方・価値観＋保存ボタン |
| 5 | 保存成功後の遷移先 | `/mypage`（変更点） |

同一ルート内でステップを進める構成のため、画面数としては1（`/onboarding`）だが、内部状態として4ステップを持つ。

---

## 3. 入力項目（ステップ別）

各項目に、既存スキーマの再利用か新規追加かを明記する。

### ステップ1：基本情報

| 項目 | 対応カラム | 状態 |
|---|---|---|
| プロフィール画像 | `profiles.avatar_path` | 既存 |
| 公開名 | `stylist_profiles.public_name` | 既存 |
| 都道府県 | `stylist_profiles.prefecture` | 既存 |
| 氏名（非公開） | `stylist_private.full_name` | 既存 |
| 年代（非公開） | `stylist_private.age_band` | 既存 |
| 性別（非公開） | `stylist_private.gender` | 既存 |

### ステップ2：キャリア

| 項目 | 対応カラム | 状態 |
|---|---|---|
| 経験年数 | `stylist_profiles.experience_years` | 既存 |
| 現在の役職 | `stylist_profiles.current_position` | 既存 |
| 得意技術 | `stylist_profiles.specialties` | 既存 |
| 現在の雇用形態 | `stylist_profiles.employment_type` | 既存 |
| Instagramアカウント（任意） | `stylist_profiles.instagram_handle` | 既存（このステップへ移動） |

### ステップ3：希望条件

| 項目 | 対応カラム | 状態 |
|---|---|---|
| 希望勤務地 | `stylist_profiles.desired_work_location` | 既存 |
| 転職意欲 | `stylist_profiles.job_change_intent` | 既存 |
| 希望年収帯 | `stylist_profiles.desired_salary_range` | 既存 |

### ステップ4：働き方・価値観

| 項目 | 対応カラム | 状態 |
|---|---|---|
| 大切にしたい働き方（複数選択） | `stylist_profiles.work_style_values`（**新規**：text[]） | **新規追加** |
| サロン選びで重視すること（複数選択） | `stylist_profiles.salon_priorities`（**新規**：text[]） | **新規追加** |
| 自己紹介・こだわり | `stylist_profiles.bio` | 既存 |
| 公開範囲 | `stylist_profiles.visibility` | 既存 |
| スカウト受信設定 | `user_settings.scout_enabled` | 既存 |

**新規カラムの選択肢案**（要確認・仮案）：
- 大切にしたい働き方：`work_life_balance`（ワークライフバランス重視）／`skill_growth`（技術力向上重視）／`teamwork`（チームワーク重視）／`independence`（独立志向）／`stability`（安定重視）／`customer_relationship`（顧客との関係重視）
- サロン選びで重視すること：`education`（教育制度）／`customer_base`（顧客層）／`salary_level`（給与水準）／`atmosphere`（人間関係・雰囲気）／`independence_support`（独立支援）／`benefits`（福利厚生）

この選択肢の文言・種類は仮案であり、実装前に内容の確認をお願いしたい。

---

## 4. `save_stylist_profile()` RPCへの影響

新規カラム（`work_style_values`／`salon_priorities`）を`stylist_profiles`へ追加するため、`save_stylist_profile()` RPCのパラメータに`p_work_style_values text[]`・`p_salon_priorities text[]`を追加し、upsert対象へ含める。**既存の対称性方針（`save_salon_profile()`との構造一致）には影響しない**（サロン側には対応する概念が無いため、`save_salon_profile()`側は変更しない）。既存のマイグレーション`0001_init.sql`へは、後方互換な`ALTER TABLE ADD COLUMN`として追加する（新規の差分マイグレーション`0003_stylist_onboarding_fields.sql`を発行する想定）。

---

## 5. バリデーション方針

- 各ステップの「次へ」ボタンは、**そのステップ内の必須項目が埋まっているかをクライアント側で簡易チェック**してから進む（診断クイズとは異なり自由入力・選択式が混在するため、必須未入力ならボタンを無効化またはエラー表示する）
- **最終的な確定バリデーション（zod）は、既存どおり最終保存時にサーバー側（Server Action）で行う。** ステップ内チェックはUXのためのものであり、セキュリティ上の防御線は最終送信時の既存の仕組みのまま変更しない

---

## 6. 画面遷移図

```mermaid
flowchart TD
  A[/onboarding 表示] --> B[ステップ1: 基本情報]
  B -->|次へ| C[ステップ2: キャリア]
  C -->|戻る| B
  C -->|次へ| D[ステップ3: 希望条件]
  D -->|戻る| C
  D -->|次へ| E[ステップ4: 働き方・価値観]
  E -->|戻る| D
  E -->|保存| F[save_stylist_profile RPC]
  F -->|成功| G[/mypage へ遷移]
  F -->|失敗| E
```

---

## 7. 確認をお願いしたい点

1. 3節「新規カラムの選択肢案」の文言・種類（働き方6種・サロン選び6種）でよいか、変更・追加があるか
2. Instagramアカウントを「ステップ2：キャリア」に配置する案でよいか（他ステップの方が適切であれば指示願いたい）
3. 保存成功後の遷移先を`/mypage`に変更する点（現状は`/`）に問題ないか

上記が確認できれば、この設計のとおり実装に着手する。
