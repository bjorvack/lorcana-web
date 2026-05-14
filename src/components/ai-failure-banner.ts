/**
 * <ai-failure-banner> — persistent inline notice + Retry button when
 * the model worker fails to initialise. Disappears as soon as a Retry
 * succeeds; otherwise sticks around so the user can come back to it.
 *
 * Wording branches off the error message per DESIGN Q5; everything
 * else falls into a generic catch-all.
 */

import { ensureClient } from "../model/inference-singleton";
import { aiStore, setAIFailed, setAIIdle, setAIOk } from "../state/ai";

const TAG = "ai-failure-banner";

interface PhrasedFailure {
  readonly title: string;
  readonly hint: string;
}

function phrase(message: string): PhrasedFailure {
  const m = message.toLowerCase();
  if (m.includes("webgpu") && m.includes("wasm")) {
    return {
      title: "Your browser can't run the AI features.",
      hint: "Both WebGPU and WASM init failed. You can still build a deck manually.",
    };
  }
  if (m.includes("404") || m.includes("missing asset") || m.includes("not found")) {
    return {
      title: "The AI model files appear to be missing from this deploy.",
      hint: "This is a deployment bug; please open an issue.",
    };
  }
  if (m.includes("session") || m.includes("ort") || m.includes("onnxruntime")) {
    return {
      title: "The AI model didn't load.",
      hint: "This is usually temporary — try Retry.",
    };
  }
  return {
    title: "The AI worker crashed.",
    hint: "Try again.",
  };
}

export class AIFailureBanner extends HTMLElement {
  #unsubscribe?: () => void;

  connectedCallback(): void {
    this.render();
    this.#unsubscribe = aiStore.subscribe(() => this.render());
  }

  disconnectedCallback(): void {
    this.#unsubscribe?.();
  }

  private async retry(): Promise<void> {
    // Reset to idle so ``ensureClient`` returns its in-flight promise
    // (or starts a fresh one) cleanly.
    setAIIdle();
    try {
      await ensureClient();
      setAIOk();
    } catch (e) {
      setAIFailed(e instanceof Error ? e.message : String(e));
    }
  }

  private render(): void {
    const state = aiStore.get();
    if (state.status !== "failed") {
      this.hidden = true;
      this.innerHTML = "";
      return;
    }
    this.hidden = false;
    this.className = "ai-failure-banner";
    this.setAttribute("role", "alert");
    const { title, hint } = phrase(state.errorMessage ?? "");
    this.innerHTML = `
      <span class="ai-failure-icon" aria-hidden="true">⚠</span>
      <span class="ai-failure-body">
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(hint)}</span>
      </span>
      <button class="primary" type="button" data-role="ai-retry">Retry</button>
    `;
    this.querySelector<HTMLButtonElement>('[data-role="ai-retry"]')?.addEventListener(
      "click",
      () => void this.retry(),
    );
  }
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

if (!customElements.get(TAG)) customElements.define(TAG, AIFailureBanner);
