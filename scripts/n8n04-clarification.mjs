export const clarificationText = 'Bạn muốn học để đạt mục tiêu gì? Bạn có thể dành thời gian học vào những lúc nào?';
export const clarificationModel = 'clarification-template-v1';

export function needsClarification(messages) {
  // shortcut: explicit uncertainty on the first turn only; expand with reviewed multi-turn cases.
  if (!Array.isArray(messages) || messages.length !== 1 || messages[0]?.sender !== 'GUEST' || typeof messages[0].text !== 'string') return false;
  const text = messages[0].text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').replace(/\s+/g, ' ');
  if (/nhan vien|tu van vien|nguoi that/.test(text)) return false;
  return /(?:chua (?:biet|ro)|khong biet)[^.!?\n]{0,80}(?:hoc gi|hoc khoa nao|chon khoa nao|bat dau tu dau)/.test(text);
}
