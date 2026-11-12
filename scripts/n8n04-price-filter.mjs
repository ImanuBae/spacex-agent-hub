// shortcut: explicit VND upper bounds in the latest guest turn; add ranges/other currencies when the product supports them.
export function filterPriceOffers(data, messages) {
  const last = Array.isArray(messages) ? messages.filter(m => m?.sender === "GUEST").at(-1)?.text : null;
  if (typeof last !== "string") return data;
  const text = last.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replaceAll("đ", "d");
  const limits = [];
  for (const match of text.matchAll(/(?:\b(?:duoi|it hon|thap hon)\s+|<\s*)(\d+(?:[.,]\d+)*)\s*(nghin|ngan|k|trieu|tr|vnd|dong|d|₫)(?=$|[\s,.;:!?])/g)) {
    if (/\b(?:khong|chang)\s*$/.test(text.slice(0, match.index))) continue;
    const numeric = /^\d{1,3}(?:[.,]\d{3})+$/.test(match[1]) ? match[1].replace(/[.,]/g, "") : match[1].replace(",", ".");
    const factor = ["nghin", "ngan", "k"].includes(match[2]) ? 1000 : ["trieu", "tr"].includes(match[2]) ? 1000000 : 1;
    const value = Number(numeric) * factor;
    if (Number.isSafeInteger(value) && value > 0) limits.push(value);
  }
  if (!limits.length) return data;
  const maxExclusiveVnd = Math.min(...limits);
  const packages = data.packages.filter(p => Number.isSafeInteger(p.priceVnd) && p.priceVnd < maxExclusiveVnd);
  return { ...data, packages, courses: data.courses.filter(c => packages.some(p => p.courseId === c.id)),
    classes: data.classes.filter(c => packages.some(p => p.id === c.packageId && p.courseId === c.courseId)),
    priceConstraint: { currency: "VND", maxExclusiveVnd } };
}
