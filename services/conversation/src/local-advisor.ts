import { z } from "zod";
import type { ChatSources, PublicClass, PublicOffer } from "@spacex/contracts";

type Reply = { text: string; sources: z.infer<typeof ChatSources> } | { errorCode: "HANDOFF" | "TOOL_ERROR" | "MODEL_ERROR" };
const money = new Intl.NumberFormat("vi-VN");
const date = new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" });
const normalize = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replaceAll("đ", "d");

async function read<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]) });
  if (!response.ok) throw new Error("Public course data unavailable");
  return (await response.json() as { data: T }).data;
}

export function createLocalAdvisor(model: string, catalogUrl: string, classUrl: string) {
  return async (messages: string[], branchId: string, signal: AbortSignal): Promise<Reply> => {
    const latest = messages.at(-1) ?? "";
    const question = normalize(latest);
    if (!/\b(khong|dung|chua)\s+(muon|can|cho|gap|noi chuyen)/.test(question)
      && /\b(gap|noi chuyen|ket noi)\b.{0,20}\b(nhan vien|tu van vien|nguoi that)\b/.test(question)) return { errorCode: "HANDOFF" };

    const offers = await read<PublicOffer[]>(`${catalogUrl}/api/v1/public-offers`, signal).catch(() => null);
    if (!Array.isArray(offers)) return { errorCode: "TOOL_ERROR" };
    const catalogReadAt = new Date().toISOString();
    const available = offers.filter(offer => offer.sellable && (!offer.branchIds.length || offer.branchIds.includes(branchId)));
    const courses = [...new Map(available.map(offer => [offer.courseId, offer])).values()].slice(0, 40);
    if (!courses.length) return { text: "Hiện chưa có gói học công khai tại chi nhánh này.", sources: [] };
    const selection = z.object({ course: z.number().int().min(0).max(courses.length) }).strict();
    let course: PublicOffer | undefined;
    try {
      const response = await fetch("http://127.0.0.1:11434/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
        body: JSON.stringify({
          model, stream: false, think: false, format: z.toJSONSchema(selection),
          options: { temperature: 0, num_ctx: 8192, num_predict: 64 },
          messages: [
            { role: "system", content: "Match the last Vietnamese question to one course in the supplied catalog. Use earlier questions to resolve references. Put its listed number in the JSON field course. Use 0 when the message does not identify a course or the topic is absent from the catalog." },
            { role: "user", content: JSON.stringify({ courses: courses.map((course, index) => ({ number: index + 1, name: course.courseName, goal: course.goal.slice(0, 90) })), earlierQuestions: messages.slice(0, -1), question: latest }) },
          ],
        }),
      });
      if (!response.ok) return { errorCode: "MODEL_ERROR" };
      const result = await response.json() as { message: { content: string } };
      course = courses[selection.parse(JSON.parse(result.message.content)).course - 1];
    } catch {
      return { errorCode: "MODEL_ERROR" };
    }

    if (!course) {
      const keywords = new Set(question.match(/\b[a-z0-9]{3,}\b/g)?.filter(word => !/^(hoc|lop|goi|khoa|ban|noi|dung|lich|gia|phi|demo)$/.test(word)));
      const named = courses.filter(offer => normalize(offer.courseName).split(/\W+/).some(word => keywords.has(word)));
      if (named.length === 1) [course] = named;
    }
    if (!course) return { text: "Bạn muốn tìm hiểu khóa học nào? Bạn có thể cho mình biết tên khóa hoặc kỹ năng muốn học.", sources: [] };

    const packages = available.filter(offer => offer.courseId === course.courseId).slice(0, 3);
    const sources: z.infer<typeof ChatSources> = [{
      api: "catalog.packages", readAt: catalogReadAt,
      offers: packages.map(offer => ({ packageId: offer.packageId, name: offer.packageName })),
    }];
    const asksSchedule = /\b(lich|khai giang|bao gio mo|lop dang mo|con (?:may|bao nhieu) cho|lich hoc)\b/.test(question);
    const asksPackage = /\b(goi|hoc phi|bao nhieu tien|gia|noi dung)\b/.test(question);
    const lines = [course.courseName];
    if (!asksSchedule || asksPackage) {
      if (course.description) lines.push(course.description.slice(0, 600));
      lines.push(...packages.map(offer => `• ${offer.packageName}: ${offer.sessionCount} buổi, ${money.format(offer.priceVnd)} ₫.`));
    }
    if (asksSchedule) {
      const snapshots = await Promise.all(packages.map(offer => read<PublicClass[]>(`${classUrl}/public/classes/${offer.packageId}`, signal))).catch(() => null);
      if (!snapshots) return { errorCode: "TOOL_ERROR" };
      const classes = snapshots.flat().filter(cls => cls.branchId === branchId && cls.availableSeats > 0 && cls.startsAt && Number.isFinite(Date.parse(cls.startsAt)));
      classes.sort((first, second) => Date.parse(first.startsAt!) - Date.parse(second.startsAt!));
      lines.push(classes.length ? classes.slice(0, 3).map(cls => `• ${cls.name}: khai giảng ${date.format(new Date(cls.startsAt!))}, còn ${cls.availableSeats} chỗ lúc tra cứu.`).join("\n") : "Chưa thấy lớp đang mở và còn chỗ tại chi nhánh này.");
      sources.push({ api: "classes.list", readAt: new Date().toISOString() });
    }
    return { text: lines.join("\n"), sources };
  };
}
