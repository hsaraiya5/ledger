"use client";

import { useEffect, useRef } from "react";
import { fmtK, MS, ymLabel } from "@/lib/ledger";

type Pt = [number, number];
export type Layer =
  | { kind: "band"; top: Pt[]; bot: Pt[]; color: string; label?: [string, string]; href?: string }
  | { kind: "area"; pts: Pt[]; color: string; dot?: boolean }
  | { kind: "line"; pts: Pt[]; color: string; dash?: string; width?: number; dot?: boolean };

export type ChartProps = {
  layers: Layer[];
  x0: number;
  x1: number;
  max: number;
  height?: number;
  mini?: boolean;
  /** "months" ticks use the ym scale; "days" ticks are plain numbers. */
  xKind?: "months" | "days";
  marks?: { y: number; label: string }[];
  hoverXs?: number[];
  tooltip?: (x: number) => string;
  onBandClick?: (href: string) => void;
  label: string;
};

const NS = "http://www.w3.org/2000/svg";
function el(tag: string, attrs: Record<string, string | number>, parent?: Element) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent?.appendChild(e);
  return e;
}
function txt(parent: Element, attrs: Record<string, string | number>, s: string) {
  const t = el("text", attrs, parent);
  t.textContent = s;
  return t;
}
function niceMax(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}
function monthTicks(x0: number, x1: number, mini?: boolean) {
  if (mini) return [{ x: x0, l: ymLabel(x0) }, { x: x1, l: ymLabel(x1) }];
  const span = x1 - x0;
  const t: { x: number; l: string }[] = [];
  if (span <= 18) {
    const step = Math.max(1, Math.ceil(span / 6));
    for (let x = x0; x <= x1; x += step) t.push({ x, l: MS[x % 12] });
    return t;
  }
  for (let y = Math.ceil(x0 / 12); y * 12 <= x1; y++) if (span < 84 || y % 2 === 0) t.push({ x: y * 12, l: String(y) });
  return t;
}

export function tipRow(name: string, value: string, color?: string, dashed?: boolean) {
  const sw = color
    ? `<i style="display:inline-block;width:10px;height:${dashed ? 0 : 8}px;border-top:${dashed ? "2px dashed " + color : "0"};background:${dashed ? "none" : color};border-radius:2px;margin-right:6px;vertical-align:middle"></i>`
    : "";
  return `<div class="r"><span>${sw}${name}</span><span>${value}</span></div>`;
}

function draw(host: HTMLDivElement, o: ChartProps) {
  host.innerHTML = "";
  const W = Math.max(240, host.clientWidth);
  const H = o.height ?? 260;
  const wide = W > 560;
  const hasLabels = o.layers.some((l) => l.kind === "band" && l.label);
  const m = o.mini ? { l: 4, r: 8, t: 8, b: 20 } : { l: 48, r: hasLabels && wide ? 132 : 14, t: 12, b: 26 };
  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": o.label }, host);
  const X = (x: number) => m.l + ((x - o.x0) / (o.x1 - o.x0 || 1)) * (W - m.l - m.r);
  const maxV = niceMax(o.max || 1);
  const Y = (v: number) => H - m.b - (v / maxV) * (H - m.t - m.b);

  for (let i = 0; i <= 4; i++) {
    if (o.mini && i % 2) continue;
    const y = Y((maxV * i) / 4);
    el("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: i ? "var(--line)" : "var(--muted)" }, svg);
    if (!o.mini) txt(svg, { x: m.l - 8, y: y + 4, "text-anchor": "end" }, fmtK((maxV * i) / 4));
  }
  const ticks =
    o.xKind === "days"
      ? [1, 8, 15, 22, o.x1].map((d) => ({ x: d, l: String(d) }))
      : monthTicks(o.x0, o.x1, o.mini);
  ticks.forEach((t, i) =>
    txt(svg, { x: X(t.x), y: H - 6, "text-anchor": o.mini ? (i ? "end" : "start") : "middle" }, t.l),
  );

  const path = (pts: Pt[]) => pts.map((q, i) => `${i ? "L" : "M"}${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join("");
  for (const L of o.layers) {
    if (L.kind === "band") {
      const d = path(L.top) + L.bot.slice().reverse().map((q) => `L${X(q[0]).toFixed(1)},${Y(q[1]).toFixed(1)}`).join("") + "Z";
      const p = el("path", { d, fill: L.color, "fill-opacity": 0.82, stroke: "var(--surface)", "stroke-width": 2, class: L.href ? "band" : "" }, svg);
      if (L.href) p.addEventListener("click", () => o.onBandClick?.(L.href!));
      if (L.label && wide) {
        const lt = L.top[L.top.length - 1], lb = L.bot[L.bot.length - 1];
        const cy = (Y(lt[1]) + Y(lb[1])) / 2;
        const g = el("g", { cursor: L.href ? "pointer" : "default" }, svg);
        txt(g, { x: W - m.r + 14, y: cy - 2, class: "elabel" }, L.label[0]);
        txt(g, { x: W - m.r + 14, y: cy + 14, class: "evalue" }, L.label[1]);
        if (L.href) g.addEventListener("click", () => o.onBandClick?.(L.href!));
      }
    } else {
      if (L.kind === "area") {
        const last = L.pts[L.pts.length - 1], first = L.pts[0];
        el("path", { d: path(L.pts) + `L${X(last[0])},${Y(0)}L${X(first[0])},${Y(0)}Z`, fill: L.color, "fill-opacity": 0.14 }, svg);
      }
      el("path", {
        d: path(L.pts), fill: "none", stroke: L.color, "stroke-linejoin": "round",
        "stroke-width": L.kind === "line" ? L.width ?? 2 : 2,
        "stroke-dasharray": L.kind === "line" ? L.dash ?? "" : "",
      }, svg);
      if (L.dot) {
        const q = L.pts[L.pts.length - 1];
        el("circle", { cx: X(q[0]), cy: Y(q[1]), r: o.mini ? 3.5 : 4.5, fill: L.color, stroke: "var(--surface)", "stroke-width": 2 }, svg);
      }
    }
  }
  for (const k of o.marks ?? []) {
    el("line", { x1: m.l, x2: W - m.r, y1: Y(k.y), y2: Y(k.y), stroke: "var(--ink-2)", "stroke-dasharray": "2 4" }, svg);
    txt(svg, { x: W - m.r, y: Y(k.y) - 6, "text-anchor": "end", style: "fill:var(--ink-2)" }, k.label);
  }

  if (!o.hoverXs?.length || !o.tooltip) return;
  const xs = o.hoverXs, tooltip = o.tooltip;
  const cross = el("line", { y1: m.t, y2: H - m.b, stroke: "var(--ink-2)", "stroke-dasharray": "3 3", visibility: "hidden", "pointer-events": "none" }, svg);
  const tip = document.createElement("div");
  tip.className = "tip";
  tip.hidden = true;
  host.appendChild(tip);
  svg.addEventListener("pointermove", (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) * W) / r.width;
    let best = xs[0];
    for (const x of xs) if (Math.abs(X(x) - px) < Math.abs(X(best) - px)) best = x;
    cross.setAttribute("x1", String(X(best)));
    cross.setAttribute("x2", String(X(best)));
    cross.setAttribute("visibility", "visible");
    tip.innerHTML = tooltip(best);
    tip.hidden = false;
    const left = (X(best) * r.width) / W;
    tip.style.left = (left > r.width / 2 ? left - tip.offsetWidth - 12 : left + 12) + "px";
  });
  svg.addEventListener("pointerleave", () => {
    tip.hidden = true;
    cross.setAttribute("visibility", "hidden");
  });
}

export function Chart(props: ChartProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    draw(host, props);
    let width = host.clientWidth;
    const ro = new ResizeObserver(() => {
      if (host.clientWidth !== width) {
        width = host.clientWidth;
        draw(host, props);
      }
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [props]);

  return <div className="chart" ref={ref} style={{ minHeight: props.height ?? 260 }} />;
}
