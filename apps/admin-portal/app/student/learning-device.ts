"use client";

import { useCallback, useSyncExternalStore } from "react";

type LessonState = { completed?: boolean; completedAt?: number; bookmarked?: boolean; note?: string };
type CourseState = { last?: string; at?: number; lessons: Record<string, LessonState> };
type LearningState = Record<string, CourseState>;
const event = "student-learning-changed";

function subscribe(update: () => void) {
  window.addEventListener("storage", update);
  window.addEventListener(event, update);
  return () => { window.removeEventListener("storage", update); window.removeEventListener(event, update); };
}

function read(key: string) {
  try { return localStorage.getItem(key) ?? "{}"; }
  catch { return "{}"; }
}

function parse(raw: string): LearningState {
  try {
    const stored: unknown = JSON.parse(raw);
    if (stored && typeof stored === "object" && !Array.isArray(stored)) {
      return Object.fromEntries(Object.entries(stored).filter(([, value]) =>
        value && typeof value === "object" && value.lessons && typeof value.lessons === "object"));
    }
  } catch { /* An invalid device cache can be replaced by a new save. */ }
  return {};
}

export function useDeviceLearning(accountId: string) {
  const key = "spacex-student-learning:" + accountId;
  const raw = useSyncExternalStore(subscribe, () => read(key), () => "{}");
  const data = parse(raw);
  const save = useCallback((course: string, lesson: string, patch?: LessonState) => {
    try {
      const saved = parse(read(key));
      const current = saved[course] ?? { lessons: {} };
      const completedAt = patch?.completed === undefined ? current.lessons[lesson]?.completedAt : patch.completed ? Date.now() : undefined;
      saved[course] = { last: lesson, at: Date.now(), lessons: { ...current.lessons,
        [lesson]: { ...current.lessons[lesson], ...patch, completedAt } } };
      localStorage.setItem(key, JSON.stringify(saved));
      window.dispatchEvent(new Event(event));
      return true;
    } catch { return false; }
  }, [key]);
  return { data, save };
}
