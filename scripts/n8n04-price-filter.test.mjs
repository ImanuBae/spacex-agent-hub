import assert from "node:assert/strict";
import { test } from "node:test";
import { filterPriceOffers } from "./n8n04-price-filter.mjs";
const data = { courses: [{ id: "c" }], packages: [{ id: "p", courseId: "c", priceVnd: 100000 }], classes: [{ id: "class", courseId: "c", packageId: "p" }], notice: "snapshot" };
const filter = input => filterPriceOffers(data, [{ sender: "GUEST", text: input }]);
test("exclusive VND bounds remove the equal-price offer and its class without altering the original source", () => {
  for (const input of ["khóa dưới 100 nghìn", "DUOI 100 ngan", "giá < 100k", "ít hơn 100.000 đồng", "thấp hơn 0,1 triệu", "dưới 100,000 VND"]) {
    const result = filter(input);
    assert.deepEqual(result.priceConstraint, { currency: "VND", maxExclusiveVnd: 100000 });
    assert.deepEqual(result.packages, []); assert.deepEqual(result.courses, []); assert.deepEqual(result.classes, []);
  }
  assert.equal(data.packages.length, 1); assert.equal(data.classes.length, 1);
  assert.equal(filter("dưới 100.001đ").packages.length, 1);
  assert.equal(filter("dưới 0.2 triệu và dưới 100k").packages.length, 0);
});
test("unrelated numbers, inclusive/lower bounds, unsafe values and old turns do not become a strict ceiling", () => {
  for (const input of ["không dưới 100k", "không ít hơn 100k", "không quá 100k", "giá <=100k", "lớp dưới 18 tuổi", "lịch học 10 giờ", "dưới 999999999999999999999 triệu"]) assert.equal(filter(input), data);
  for (const messages of [null, [], [{ sender: "GUEST", text: null }], [{ sender: "AI", text: "dưới 100k" }], [{ sender: "GUEST", text: "dưới 100k" }, { sender: "GUEST", text: "tôi không còn giới hạn giá" }]]) assert.equal(filterPriceOffers(data, messages), data);
});
