/**
 * Cosine-distance novelty term.
 *
 * For a candidate card embedding ``c`` and a set of L2-normalised
 * archetype centroids ``A``, novelty(c) = 1 − max_i cos(c, A_i). A
 * higher value means "c is far from every known archetype" and thus
 * a more exploratory pick.
 *
 * The centroids are pre-normalised by ``lorcana-train build-tables``;
 * the candidate embedding is normalised here at call time so callers
 * don't have to worry about it.
 */

import type { ArchetypeCentroids } from "../model/bundle";

export function cosineDistanceToNearestCentroid(
  embedding: Float32Array | number[],
  centroids: ArchetypeCentroids,
): number {
  if (embedding.length !== centroids.dim) {
    throw new Error(`embedding dim ${embedding.length} != centroid dim ${centroids.dim}`);
  }
  // L2-normalise the candidate once.
  let sq = 0;
  for (let i = 0; i < embedding.length; i++) sq += embedding[i]! * embedding[i]!;
  const norm = Math.sqrt(sq) || 1;

  let maxCos = -Infinity;
  for (let k = 0; k < centroids.centroids.length; k++) {
    const row = centroids.centroids[k]!;
    let dot = 0;
    for (let i = 0; i < embedding.length; i++) {
      dot += (embedding[i]! / norm) * row[i]!;
    }
    if (dot > maxCos) maxCos = dot;
  }
  // Cosine *similarity* in [-1, 1]; convert to a distance in [0, 2].
  // Clamping for safety against fp drift slipping past 1.0.
  return Math.max(0, 1 - Math.min(1, maxCos));
}
