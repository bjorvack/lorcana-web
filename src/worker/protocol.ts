/** Shared message types between the main thread and inference.worker.ts. TODO. */
export interface InferenceRequest {
  readonly kind: "predict";
  readonly partialDeckCardIds: readonly string[];
  readonly style: "safe" | "balanced" | "brew";
}

export interface InferenceResponse {
  readonly kind: "prediction";
  readonly suggestions: readonly { cardId: string; score: number }[];
}
