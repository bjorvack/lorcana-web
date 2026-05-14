/**
 * Lazily-instantiated, app-wide singleton wrapping ``InferenceClient``.
 *
 * The model bundle is ~30 MB and spawning the ORT worker isn't free,
 * so multiple consumers (the deck-generator's Generate button + the
 * live-realism scorer) share one client. The first ``ensureClient``
 * call wins the init race; subsequent calls await the same promise.
 */

import { loadModelBundle } from "./bundle";
import { loadVocabMap, type VocabMap } from "./vocab";
import { InferenceClient } from "../worker/client";

let client: InferenceClient | null = null;
let vocab: VocabMap | null = null;
let initPromise: Promise<void> | null = null;
let initError: Error | null = null;

export interface SharedInference {
  readonly client: InferenceClient;
  readonly vocab: VocabMap;
}

/**
 * Returns the already-initialised pair, or ``null`` if no caller has
 * triggered ``ensureClient`` yet. Cheap to poll from a UI subscriber.
 */
export function peekInference(): SharedInference | null {
  return client && vocab && initError === null ? { client, vocab } : null;
}

/** Has the shared client crashed during init? */
export function inferenceInitError(): Error | null {
  return initError;
}

/**
 * Boot the shared client. Idempotent: subsequent calls await the same
 * promise. ``onProgress`` is invoked exactly once with each transition
 * (download → onnx load) so the caller can render a status string.
 */
export async function ensureClient(
  onProgress?: (phase: "downloading-bundle" | "loading-sessions") => void,
): Promise<SharedInference> {
  if (client && vocab && !initError) return { client, vocab };
  if (initPromise) {
    await initPromise;
    if (initError) throw initError;
    return { client: client!, vocab: vocab! };
  }
  initPromise = (async () => {
    try {
      onProgress?.("downloading-bundle");
      const [bundle, v] = await Promise.all([loadModelBundle(), loadVocabMap()]);
      vocab = v;
      onProgress?.("loading-sessions");
      const c = new InferenceClient();
      await c.init(bundle);
      client = c;
    } catch (e) {
      initError = e instanceof Error ? e : new Error(String(e));
      throw initError;
    }
  })();
  await initPromise;
  return { client: client!, vocab: vocab! };
}
