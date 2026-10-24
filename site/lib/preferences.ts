"use client";
import { useEffect, useState } from "react";
import { batchCodes } from "./locations";
import type { Notice, Purpose } from "./notam";
export const preferenceKey = "notam-watch:preferences:v1";
export type Preferences = { codes: string[]; mode: string; hours: number; query: string; approx: boolean; priorityOnly: boolean; enabled: Purpose[]; rangeStart: string; rangeEnd: string; resetAt: number };
export const defaults = (): Preferences => ({ codes: [...batchCodes], mode: "all", hours: 24, query: "", approx: false, priorityOnly: true, enabled: ["hazard", "firing", "training", "drone"], rangeStart: "", rangeEnd: "", resetAt: 0 });
export const validCode = (value: string) => /^[A-Z]{4}$/.test(value);
export function readPreferences(): Preferences {
  const base = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(preferenceKey) || "null");
    if (!raw || typeof raw !== "object") return base;
    return { ...base,
      codes: Array.isArray(raw.codes) ? [...new Set<string>(raw.codes.filter((v: unknown) => typeof v === "string" && validCode(v)).map((v: string) => v === "RCCS" ? "RCSS" : v))] : base.codes,
      mode: ["all", "issued", "active", "range", "upcoming", "unknown"].includes(raw.mode) ? raw.mode : base.mode,
      hours: Number.isFinite(raw.hours) ? Math.min(720, Math.max(1, raw.hours)) : 24,
      query: typeof raw.query === "string" ? raw.query : "",
      approx: raw.approx === true,
      priorityOnly: typeof raw.priorityOnly === "boolean" ? raw.priorityOnly : base.priorityOnly,
      enabled: Array.isArray(raw.enabled) ? raw.enabled.filter((v: string) => ["hazard", "firing", "training", "drone", "other"].includes(v)) : base.enabled,
      rangeStart: typeof raw.rangeStart === "string" ? raw.rangeStart : "",
      rangeEnd: typeof raw.rangeEnd === "string" ? raw.rangeEnd : "",
      resetAt: Number.isFinite(raw.resetAt) ? raw.resetAt : 0,
    };
  } catch { return base; }
}
export function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  useEffect(() => {
    const read = () => setPreferences(readPreferences());
    read(); setReady(true);
    window.addEventListener("storage", read);
    window.addEventListener("notam-preferences", read);
    return () => { window.removeEventListener("storage", read); window.removeEventListener("notam-preferences", read); };
  }, []);
  const update = (patch: Partial<Preferences>) => {
    const next = { ...readPreferences(), ...patch };
    setPreferences(next);
    try { localStorage.setItem(preferenceKey, JSON.stringify(next)); setStorageError(""); window.dispatchEvent(new Event("notam-preferences")); }
    catch { setStorageError("このブラウザでは設定を保存できません。保存を許可してから、もう一度変更してください。"); }
  };
  return { preferences, ready, update, storageError };
}
export async function snapshot(action: "read" | "write" | "clear", items?: Notice[], fetchedAt: number | null = null): Promise<{ items: Notice[]; savedAt: number | null; cachedAt?: number } | null> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("notam-watch", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("data");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("data", action === "read" ? "readonly" : "readwrite");
      const store = tx.objectStore("data");
      const request = action === "read" ? store.get("notams") : action === "clear" ? store.delete("notams") : store.put({ items, savedAt: fetchedAt, cachedAt: Date.now() }, "notams");
      tx.oncomplete = () => resolve(action === "read" ? request.result ?? null : null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
