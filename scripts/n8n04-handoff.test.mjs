import assert from "node:assert/strict";
import { test } from "node:test";
import { humanRequested } from "./n8n04-handoff.mjs";
test("an explicit current guest request reaches a human without model dependence; unrelated and negated requests do not", () => {
  for (const text of ["Tôi muốn nói chuyện với nhân viên thay vì AI.", "Cho tôi gặp tư vấn viên", "Mình cần kết nối người thật"]) assert.equal(humanRequested([{ sender: "GUEST", text }]), true);
  for (const text of ["Tôi không muốn nói chuyện với nhân viên", "Chưa cần gặp nhân viên", "Cho biết nhân viên dạy khóa nào", "Đăng ký ngay, giữ chỗ và tạo QR", "Giá khóa online"]) assert.equal(humanRequested([{ sender: "GUEST", text }]), false);
  for (const messages of [null, [], [{sender:"AI",text:"Muốn nói chuyện nhân viên"}], [{sender:"GUEST",text:null}], [{sender:"GUEST",text:"Muốn gặp nhân viên"},{sender:"GUEST",text:"Giá khóa online"}]]) assert.equal(humanRequested(messages), false);
});
