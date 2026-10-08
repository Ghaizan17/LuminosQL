import { describe, expect, it } from "vitest";
import { anchor, edgePath, gridLayout } from "../src/designer/layout";

describe("grid layout", () => {
  it("flows into columns without overlap", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const sizes = Object.fromEntries(ids.map((id) => [id, { id, w: 200, h: 100 }]));
    const placed = gridLayout(ids, sizes, 2);
    expect(placed.a.x).toBe(0);
    expect(placed.b.x).toBe(0);
    expect(placed.c.x).toBeGreaterThan(placed.b.x);
    expect(placed.b.y).toBeGreaterThan(placed.a.y);
    const boxes = Object.values(placed);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const [p, q] = [boxes[i], boxes[j]];
        const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
        expect(overlap).toBe(false);
      }
    }
  });
});

describe("edges", () => {
  it("anchors face each other and paths are orthogonal", () => {
    const a = { id: "a", w: 200, h: 100, x: 0, y: 0 };
    const b = { id: "b", w: 200, h: 100, x: 400, y: 200 };
    const { from, to } = anchor(a, b);
    expect(from.x).toBe(200);
    expect(to.x).toBe(400);
    const d = edgePath(from, to);
    expect(d.match(/L/g)?.length).toBe(3);
  });
});
