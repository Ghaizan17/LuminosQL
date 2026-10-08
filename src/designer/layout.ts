/** Pure ER-diagram geometry: grid auto-layout + FK edge routing. No DOM. */

export interface Box {
  id: string;
  w: number;
  h: number;
}

export interface Placed extends Box {
  x: number;
  y: number;
}

export interface Edge {
  id: string;
  from: string;
  to: string;
}

/** Flow tables left→right, top→bottom in columns of `perColumn`. */
export function gridLayout(ids: string[], sizes: Record<string, Box>, perColumn = 4): Record<string, Placed> {
  const gapX = 80;
  const gapY = 48;
  const cols: { x: number; y: number; w: number }[] = [];
  const out: Record<string, Placed> = {};
  ids.forEach((id, i) => {
    const col = Math.floor(i / perColumn);
    const size = sizes[id] ?? { id, w: 220, h: 120 };
    while (cols.length <= col) {
      const prevX = cols.length === 0 ? 0 : cols[cols.length - 1].x + cols[cols.length - 1].w + gapX;
      cols.push({ x: prevX, y: 0, w: 0 });
    }
    const slot = cols[col];
    out[id] = { ...size, id, x: slot.x, y: slot.y };
    slot.y += size.h + gapY;
    slot.w = Math.max(slot.w, size.w);
  });
  return out;
}

export interface Port {
  x: number;
  y: number;
}

/** Anchor on the box edge facing the other box (horizontal preference). */
export function anchor(a: Placed, b: Placed): { from: Port; to: Port } {
  const aCx = a.x + a.w / 2;
  const bCx = b.x + b.w / 2;
  const from = { x: aCx < bCx ? a.x + a.w : a.x, y: a.y + 28 };
  const to = { x: aCx < bCx ? b.x : b.x + b.w, y: b.y + 28 };
  return { from, to };
}

/** Orthogonal connector: horizontal out, vertical across, horizontal in. */
export function edgePath(from: Port, to: Port): string {
  const midX = (from.x + to.x) / 2;
  return `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`;
}

export function edgeLabel(from: Port, to: Port): Port {
  return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 6 };
}
