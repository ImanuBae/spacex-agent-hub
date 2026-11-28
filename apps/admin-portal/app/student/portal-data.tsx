"use client";

import { useEffect, useState } from "react";
import type { PublicOffer } from "@spacex/contracts";
import { api, OperationError } from "../../lib/services/classes";
import type { Enrollment, Schedule } from "../../lib/student-portal";

export function useStudentResource<T>(path: string | undefined, interval = 0) {
  const [result, setResult] = useState<{ path: string; data?: T; error?: unknown }>();
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    if (!path) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const resource = path;
    function poll() {
      timer = setTimeout(() => {
        if (document.hidden) poll();
        else void load();
      }, interval);
    }
    async function load() {
      try {
        const { data } = await api<T>(resource);
        if (live) setResult({ path: resource, data });
      } catch (error) {
        if (live) setResult(current => ({ path: resource, data: current?.path === resource ? current.data : undefined, error }));
      } finally {
        if (live) {
          setRefreshing(false);
          if (interval) poll();
        }
      }
    }
    void load();
    return () => { live = false; clearTimeout(timer); };
  }, [path, interval, attempt]);
  const current = result?.path === path ? result : undefined;
  return { data: current?.data, error: current?.error, refreshing, reload: () => { setRefreshing(true); setAttempt(n => n + 1); } };
}

export function useStudentClock(interval = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const timer = setInterval(refresh, interval);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [interval]);
  return now;
}

export function useSchedules(enrollments: Enrollment[] | undefined) {
  const [result, setResult] = useState<{ source: Enrollment[]; schedules: Schedule[]; failed: number }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enrollments?.length) return;
    let live = true;
    const active = enrollments.filter(row => row.currentEntitlement.state === "ACTIVE");
    void Promise.allSettled(active.map(async row => (await api<Schedule>("student/class-schedule/" + row.id)).data)).then(rows => {
      if (!live) return;
      const schedules = rows.flatMap(row => row.status === "fulfilled" ? [row.value] : []);
      setResult({ source: enrollments, schedules, failed: rows.length - schedules.length });
    });
    return () => { live = false; };
  }, [enrollments, attempt]);
  const current = result?.source === enrollments ? result : undefined;
  return { schedules: current?.schedules, failed: current?.failed ?? 0, retry: () => setAttempt(n => n + 1) };
}

export function useOffers() {
  return useStudentResource<PublicOffer[]>("public-offers");
}

export async function library<T>(course?: string, signal?: AbortSignal) {
  const response = await fetch("/api/student-library" + (course ? "?course=" + encodeURIComponent(course) : ""), { cache: "no-store", signal });
  if (response.status === 401) window.dispatchEvent(new Event("hub:unauthorized"));
  const body = await response.json();
  if (!response.ok) throw new OperationError(body.error?.message ?? "Chưa tải được học liệu.", body.error?.code);
  return body.data as T;
}

export function useLibrary<T>(course?: string) {
  const [result, setResult] = useState<{ course?: string; data?: T; error?: unknown }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void library<T>(course, controller.signal).then(
      data => { if (!controller.signal.aborted) setResult({ course, data }); },
      error => { if (!controller.signal.aborted) setResult({ course, error }); },
    );
    return () => controller.abort();
  }, [course, attempt]);
  const current = result?.course === course ? result : undefined;
  return { data: current?.data, error: current?.error, reload: () => setAttempt(n => n + 1) };
}
