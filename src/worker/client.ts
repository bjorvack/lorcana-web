/**
 * Main-thread API for talking to the inference worker.
 *
 * Single-shot, promise-based: ``init()`` returns a promise that
 * resolves once the worker has loaded its ORT sessions; ``generate()``
 * returns a promise for the final deck. Progress events from the
 * worker are delivered as DOM-style events on the client itself so
 * the UI can subscribe with ``addEventListener``.
 */

import type { GenerateRequest, ModelBundle, StyleName, WorkerEvent } from "./protocol";

export class InferenceClient extends EventTarget {
  #worker: Worker | null = null;
  #nextRequestId = 1;
  #pending = new Map<
    number,
    { resolve: (event: WorkerEvent) => void; reject: (err: Error) => void }
  >();
  #ready: Promise<void> | null = null;

  /** Lazily spawn the worker + load the model. Safe to call repeatedly. */
  async init(bundle: ModelBundle): Promise<void> {
    if (this.#ready) return this.#ready;
    this.#worker = new Worker(new URL("./inference.worker.ts", import.meta.url), {
      type: "module",
    });
    this.#worker.addEventListener("message", (e: MessageEvent<WorkerEvent>) =>
      this.#handleMessage(e.data),
    );
    this.#worker.addEventListener("error", (e) => {
      // Reject every outstanding request rather than swallow the
      // worker's startup failure silently.
      for (const [, pending] of this.#pending) {
        pending.reject(new Error(e.message || "worker error"));
      }
      this.#pending.clear();
    });
    this.#ready = this.#request<WorkerEvent>({
      kind: "init",
      requestId: this.#nextRequestId++,
      bundle,
    }).then(() => undefined);
    return this.#ready;
  }

  /** Fill the deck from the given partial to 60 cards. */
  async generate(args: Omit<GenerateRequest, "kind" | "requestId">): Promise<{
    deck: ReadonlyArray<readonly [number, number]>;
    realism: number;
  }> {
    if (!this.#worker) throw new Error("InferenceClient.init() not awaited yet");
    const event = await this.#request<WorkerEvent>({
      kind: "generate",
      requestId: this.#nextRequestId++,
      ...args,
    });
    if (event.kind !== "generate-done") {
      throw new Error(`unexpected event kind: ${event.kind}`);
    }
    return { deck: event.deck, realism: event.realism };
  }

  #request<T extends WorkerEvent>(req: {
    kind: string;
    requestId: number;
    [k: string]: unknown;
  }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(req.requestId, { resolve: resolve as (e: WorkerEvent) => void, reject });
      this.#worker?.postMessage(req);
    });
  }

  #handleMessage(event: WorkerEvent): void {
    // Progress events fan out as DOM events; only terminal events
    // (init-done / generate-done / error) resolve the pending promise.
    if (event.kind === "generate-progress") {
      this.dispatchEvent(new CustomEvent("progress", { detail: event }));
      return;
    }
    const pending = this.#pending.get(event.requestId);
    if (!pending) return;
    this.#pending.delete(event.requestId);
    if (event.kind === "error") {
      pending.reject(new Error(event.message));
    } else {
      pending.resolve(event);
    }
  }

  terminate(): void {
    this.#worker?.terminate();
    this.#worker = null;
    this.#ready = null;
  }
}

/** Re-export :class:`StyleName` so UI code can import from one place. */
export type { StyleName };
