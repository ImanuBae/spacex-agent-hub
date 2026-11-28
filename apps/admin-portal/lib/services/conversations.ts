import { request } from "../request";
import type { ChatSources } from "@spacex/contracts";
export interface ChatMessage { id: string; sender: string; text: string; delivery: string; createdAt: string; sources: ReturnType<typeof ChatSources.parse>; }
export interface Conversation { id: string; mode: "AI" | "HUMAN"; version: number; ownerId?: string; errorCode?: string; aiEnabled?: boolean; messages: ChatMessage[]; }
export const conversations = {
  list: () => request<Conversation[]>("/api/v1/conversations"),
  get: (id: string) => request<Conversation>(`/api/v1/conversations/${id}`),
  mode: (c: Conversation, mode: "AI" | "HUMAN") => request<Conversation>(`/api/v1/conversations/${c.id}/mode`, { method: "POST", body: JSON.stringify({ mode, expectedVersion: c.version }) }),
  send: (c: Conversation, clientMessageId: string, text: string) => request(`/api/v1/conversations/${c.id}/messages`, { method: "POST", body: JSON.stringify({ clientMessageId, text, expectedVersion: c.version }) }),
};
