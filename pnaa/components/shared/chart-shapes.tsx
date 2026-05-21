"use client";

// Per-corner rounded rectangle for recharts `<Bar shape={...} />`. Recharts'
// built-in `radius` applies to every cell in a series, which breaks stacked
// bars when one segment is zero (the visible cell ends up flat where it
// should be capped). We render per-cell paths so the outer-edge rounding
// tracks each row's actual data.
//
// Note: recharts hands the shape callback a bunch of internal props
// (`stackedBarStart`, `tooltipPosition`, `originalDataIndex`, `isActive`,
// `parentViewBox`, …). We deliberately do NOT spread those onto the <path>
// element — React warns about unknown DOM attributes if you do.
export type Corners = [number, number, number, number]; // tl, tr, br, bl

export function RoundedRect({
  x,
  y,
  width,
  height,
  fill,
  radius,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fill?: string;
  radius: Corners;
}) {
  const w = Number(width ?? 0);
  const h = Number(height ?? 0);
  if (w <= 0 || h <= 0) return null;
  const ox = Number(x ?? 0);
  const oy = Number(y ?? 0);
  const cap = Math.min(w, h) / 2;
  const [tl, tr, br, bl] = radius.map((r) =>
    Math.max(0, Math.min(r, cap))
  ) as Corners;
  const d = [
    `M ${ox + tl} ${oy}`,
    `H ${ox + w - tr}`,
    tr > 0 ? `Q ${ox + w} ${oy} ${ox + w} ${oy + tr}` : "",
    `V ${oy + h - br}`,
    br > 0 ? `Q ${ox + w} ${oy + h} ${ox + w - br} ${oy + h}` : "",
    `H ${ox + bl}`,
    bl > 0 ? `Q ${ox} ${oy + h} ${ox} ${oy + h - bl}` : "",
    `V ${oy + tl}`,
    tl > 0 ? `Q ${ox} ${oy} ${ox + tl} ${oy}` : "",
    "Z",
  ]
    .filter(Boolean)
    .join(" ");
  return <path d={d} fill={fill} />;
}

// Factory that produces a recharts `shape` handler for one segment of a
// 2-segment stacked bar. Picks the outer-edge rounding from the row's data
// so a row with a single non-zero segment caps cleanly.
//
//   orientation: "vertical" — bars rise from the X-axis (first declared = bottom)
//   orientation: "horizontal" — bars extend right from the Y-axis (first declared = left)
//   position: "first" = bottom (vertical) or left (horizontal)
//   position: "last"  = top (vertical) or right (horizontal)
export function makeStackShape(opts: {
  orientation: "vertical" | "horizontal";
  position: "first" | "last";
  myKey: string;
  otherKey: string;
}) {
  return function StackShape(props: unknown) {
    const p = props as { payload?: Record<string, unknown> };
    const me = Number(p.payload?.[opts.myKey] ?? 0);
    const other = Number(p.payload?.[opts.otherKey] ?? 0);
    let radius: Corners = [0, 0, 0, 0];

    if (opts.orientation === "vertical") {
      // Stack rises from the x-axis; only the TOP edge can be rounded.
      if (opts.position === "last") {
        radius = me > 0 ? [4, 4, 0, 0] : [0, 0, 0, 0];
      } else {
        radius = me > 0 && other === 0 ? [4, 4, 0, 0] : [0, 0, 0, 0];
      }
    } else {
      // Horizontal: round the OUTER edge. Single visible segment → all corners.
      if (opts.position === "first") {
        radius =
          me > 0 && other === 0
            ? [4, 4, 4, 4]
            : me > 0
              ? [4, 0, 0, 4]
              : [0, 0, 0, 0];
      } else {
        radius =
          me > 0 && other === 0
            ? [4, 4, 4, 4]
            : me > 0
              ? [0, 4, 4, 0]
              : [0, 0, 0, 0];
      }
    }

    return <RoundedRect {...(props as object)} radius={radius} />;
  };
}
