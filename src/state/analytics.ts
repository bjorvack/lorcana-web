/**
 * Analytics consent state + GA4 injection.
 *
 * Per DESIGN Q8, GA4 only loads after the user accepts the inline
 * consent banner. Until then, no GA script tag, no GA cookie, no
 * traffic. Declining is persisted just like accepting so we don't
 * re-prompt on every page load.
 *
 * The GA4 Measurement ID is read from a Vite-time env var
 * (``VITE_GA4_MEASUREMENT_ID``); when unset, the consent banner
 * still works but the Accept branch silently no-ops, so a local
 * `pnpm dev` doesn't pretend it's wired to a real property.
 */

import { createStore, type Store } from "./store";

const STORAGE_KEY = "lorcana:analytics-consent";
const CONSENT_VERSION = 1;

export type ConsentChoice = "unset" | "accepted" | "declined";

export interface ConsentRecord {
  readonly choice: ConsentChoice;
  /** ISO-8601 timestamp of when the user last made the choice. */
  readonly at: string | null;
}

export const consentStore: Store<ConsentRecord> = createStore<ConsentRecord>(loadConsent());

function loadConsent(): ConsentRecord {
  if (typeof localStorage === "undefined") return { choice: "unset", at: null };
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return { choice: "unset", at: null };
  }
  if (!raw) return { choice: "unset", at: null };
  try {
    const parsed = JSON.parse(raw) as { version?: number; choice?: ConsentChoice; at?: string };
    if (parsed.version !== CONSENT_VERSION) return { choice: "unset", at: null };
    if (parsed.choice !== "accepted" && parsed.choice !== "declined") {
      return { choice: "unset", at: null };
    }
    return { choice: parsed.choice, at: parsed.at ?? null };
  } catch {
    return { choice: "unset", at: null };
  }
}

function persist(record: ConsentRecord): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: CONSENT_VERSION, choice: record.choice, at: record.at }),
    );
  } catch {
    // Quota / private mode → next visit re-prompts. Acceptable.
  }
}

export function setConsent(choice: "accepted" | "declined"): void {
  const record: ConsentRecord = { choice, at: new Date().toISOString() };
  persist(record);
  consentStore.set(record);
  if (choice === "accepted") void loadGA();
}

export function reopenConsent(): void {
  // The banner is mounted but hidden unless ``unset``. To re-prompt
  // we flip the store back to unset *without* wiping the previous
  // choice; the banner shows again and a new selection overwrites.
  consentStore.set({ choice: "unset", at: consentStore.get().at });
}

let gaLoaded = false;
async function loadGA(): Promise<void> {
  if (gaLoaded) return;
  const id = import.meta.env.VITE_GA4_MEASUREMENT_ID as string | undefined;
  if (!id) return;
  gaLoaded = true;
  // Inject the GA4 loader exactly the way Google documents. The
  // gtag stub is hoisted onto window so calls before the script
  // loads are queued and replayed.
  const w = window as unknown as { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void };
  w.dataLayer = w.dataLayer ?? [];
  w.gtag = function (...args: unknown[]) {
    w.dataLayer!.push(args);
  };
  w.gtag("js", new Date());
  w.gtag("config", id, { anonymize_ip: true });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.append(script);
}

/**
 * Boot-time autoload: if the user accepted on a previous visit,
 * load GA without re-prompting.
 */
export function bootAnalytics(): void {
  if (consentStore.get().choice === "accepted") void loadGA();
}
