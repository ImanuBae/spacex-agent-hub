export const humanRuleModel = "explicit-human-rule-v1";
export function humanRequested(messages) {
  const text = Array.isArray(messages) ? messages.filter(m => m?.sender === "GUEST").at(-1)?.text : null;
  if (typeof text !== "string") return false;
  const normalized = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replaceAll("đ", "d");
  if (/\b(khong|dung|chua)\s+(muon|can|cho|gap|noi chuyen)/.test(normalized)) return false;
  return /\b(muon|can|cho)\b.{0,30}\b(gap|noi chuyen|ket noi)\b.{0,20}\b(nhan vien|tu van vien|nguoi that)\b/.test(normalized);
}
