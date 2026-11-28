import test from "node:test";
import assert from "node:assert/strict";
import { salonPriceRows } from "../lib/billing/price-list";

test("料金表は確定仕様と一致する", () => {
  const rows = salonPriceRows(); const get = (k: string) => rows.find((r) => r.label.includes(k))!;
  assert.equal(get("通常登録").price, "税込33,000円");
  assert.equal(get("キャンペーン登録").price, "0円");
  assert.equal(get("月額").price, "無料");
  assert.equal(get("追加購入").price, "税込11,000円");
  assert.match(get("追加購入").note!, /1年間有効/);
  assert.match(get("追加購入").note!, /返金は原則/);
  assert.equal(get("スタイリスト").price, "税抜550,000円");
  assert.equal(get("アシスタント").price, "税抜450,000円");
  assert.equal(get("見学").price, "税込55,000円"); assert.match(get("見学").note!, /税抜50,000円/);
});
