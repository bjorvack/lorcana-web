/**
 * <mana-curve> — canvas bar chart for the deck's ink cost distribution.
 *
 * No chart library, no SVG. Drawn into a single <canvas> at devicePixel
 * resolution and re-rendered on every deck-store update. The cost
 * buckets come from the ``manaCurve`` selector (0..6 + a 7+ bucket).
 *
 * The bar above each cost shows the number of cards at that cost; the
 * tallest bucket sets the y-axis. A subtle baseline label sits under
 * each column. The chart is purely informational, so when the deck is
 * empty we render a flat placeholder rather than collapsing the panel.
 */

import { deckStore } from "../state/index";
import { manaCurve, MAX_CURVE_COST } from "../state/selectors";

const TAG = "mana-curve";

const PADDING_X = 8;
const PADDING_TOP = 12;
const PADDING_BOTTOM = 22;
const BAR_GAP = 6;
const MIN_HEIGHT = 80;

export class ManaCurve extends HTMLElement {
  #canvas: HTMLCanvasElement | null = null;
  #unsubscribe?: () => void;
  #resizeObs?: ResizeObserver;

  connectedCallback(): void {
    this.render();
    this.#unsubscribe = deckStore.subscribe(() => this.draw());
    // Re-draw on container resize so the chart scales when the panel
    // re-flows on mobile / sidebar collapse.
    if (this.#canvas && "ResizeObserver" in window) {
      this.#resizeObs = new ResizeObserver(() => this.draw());
      this.#resizeObs.observe(this);
    }
  }

  disconnectedCallback(): void {
    this.#unsubscribe?.();
    this.#resizeObs?.disconnect();
  }

  private render(): void {
    this.innerHTML = `<canvas class="mana-curve-canvas" aria-hidden="true"></canvas>
      <span class="visually-hidden" data-role="mana-curve-summary"></span>`;
    this.#canvas = this.querySelector<HTMLCanvasElement>("canvas");
    this.draw();
  }

  private draw(): void {
    const canvas = this.#canvas;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(rect.width, 200);
    const height = Math.max(rect.height || MIN_HEIGHT, MIN_HEIGHT);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.height = `${height}px`;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const points = manaCurve(deckStore.get());
    const peak = Math.max(1, ...points.map((p) => p.count));
    const barCount = points.length; // 8 (costs 0..7+)
    const usable = width - PADDING_X * 2;
    const barWidth = Math.max(8, (usable - BAR_GAP * (barCount - 1)) / barCount);
    const chartTop = PADDING_TOP;
    const chartBottom = height - PADDING_BOTTOM;
    const chartHeight = Math.max(10, chartBottom - chartTop);

    // Theme-aware colours: prefer text-muted for axis labels + an
    // accent for the bar itself so light/dark mode both look right.
    const styles = getComputedStyle(this);
    const muted = styles.getPropertyValue("--text-muted").trim() || "#999";
    const accent = styles.getPropertyValue("--accent").trim() || "#6aa3ff";
    const border = styles.getPropertyValue("--border").trim() || "#33333355";

    // Baseline.
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING_X, chartBottom + 0.5);
    ctx.lineTo(width - PADDING_X, chartBottom + 0.5);
    ctx.stroke();

    ctx.font = "11px system-ui, -apple-system, sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "center";

    for (let i = 0; i < points.length; i++) {
      const p = points[i]!;
      const x = PADDING_X + i * (barWidth + BAR_GAP);
      const h = (p.count / peak) * chartHeight;
      const y = chartBottom - h;
      ctx.fillStyle = accent;
      ctx.fillRect(x, y, barWidth, h);
      // Count number above the bar (skip 0 to reduce noise).
      if (p.count > 0) {
        ctx.fillStyle = muted;
        ctx.fillText(String(p.count), x + barWidth / 2, Math.max(0, y - 14));
      }
      // Cost label below baseline. Last bucket is "7+".
      ctx.fillStyle = muted;
      const label = p.cost === MAX_CURVE_COST ? `${MAX_CURVE_COST}+` : String(p.cost);
      ctx.fillText(label, x + barWidth / 2, chartBottom + 4);
    }

    const summary = this.querySelector<HTMLElement>('[data-role="mana-curve-summary"]');
    if (summary) {
      summary.textContent =
        points
          .map(
            (p) => `${p.cost === MAX_CURVE_COST ? `${MAX_CURVE_COST}+` : p.cost}-cost: ${p.count}`,
          )
          .join(", ") || "empty";
    }
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, ManaCurve);
