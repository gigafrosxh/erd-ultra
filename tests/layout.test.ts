import { describe, expect, it } from "vitest";
import { parseErDsl } from "../src/er/dsl";
import { autoLayout } from "../src/er/layout";
import { type ErDiagram, nodeSize } from "../src/er/model";
import { SIMPLE_EXAMPLE } from "../src/examples";
import { EXAMPLES } from "./fixtures";

/** Paare von Knoten, deren Rahmen sich überschneiden */
function overlaps(d: ErDiagram): string[] {
  const out: string[] = [];
  const ns = d.nodes.map((n) => ({ n, ...nodeSize(n) }));
  for (let i = 0; i < ns.length; i++)
    for (let j = i + 1; j < ns.length; j++) {
      const a = ns[i];
      const b = ns[j];
      if (Math.abs(a.n.x - b.n.x) < (a.w + b.w) / 2 && Math.abs(a.n.y - b.n.y) < (a.h + b.h) / 2) out.push(`${a.n.name} ↔ ${b.n.name}`);
    }
  return out;
}

describe("Auto-Layout", () => {
  for (const ex of [{ id: "einfach", dsl: SIMPLE_EXAMPLE }, ...EXAMPLES]) {
    it(`${ex.id}: keine überlappenden Elemente`, () => {
      const d = parseErDsl(ex.dsl).diagram;
      expect(overlaps(d)).toEqual([]);
      autoLayout(d);
      expect(overlaps(d)).toEqual([]);
    });
  }
});
