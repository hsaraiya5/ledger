"use client";

import { useEffect, useRef } from "react";

const ROW = 4; // px per grid row; each child spans enough rows for its height plus the gap

/**
 * A .dash grid whose panels pack like a masonry wall: each child spans rows for its own height,
 * and dense flow lets shorter panels slide up into the holes beside taller ones.
 */
export function Packed({ className, children }: { className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const grid = ref.current!;
    const items = Array.from(grid.children) as HTMLElement[];
    const fit = () => {
      const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
      for (const el of items) el.style.gridRowEnd = `span ${Math.ceil((el.getBoundingClientRect().height + gap) / ROW)}`;
      // Packing only switches on once spans are set, so the first paint is the plain grid.
      grid.classList.add("packed");
    };
    const ro = new ResizeObserver(fit);
    items.forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, []);
  return (
    <div className="pack">
      <div ref={ref} className={className}>{children}</div>
    </div>
  );
}
