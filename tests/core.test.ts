import { describe, expect, it } from "vitest";
import { parseErDsl, serializeErDsl } from "../src/er/dsl";
import { parseRelDsl, serializeRelDsl } from "../src/rel/dsl";
import { mapErToRelational, type InheritanceStrategy } from "../src/rel/mapping";
import { generateData, datasetToSql } from "../src/data/generator";
import { schemaToSql } from "../src/rel/sql";
import { SIMPLE_EXAMPLE } from "../src/examples";
import { EXAMPLES } from "./fixtures";
import { compareVersions, pickUpdate } from "../src/lib/update";

describe("ER-DSL", () => {
  for (const ex of [{ id: "einfach", dsl: SIMPLE_EXAMPLE }, ...EXAMPLES]) {
    it(`parst Beispiel ${ex.id} ohne Fehler und Round-Trip ist stabil`, () => {
      const r = parseErDsl(ex.dsl);
      expect(r.errors.map((e) => e.message)).toEqual([]);
      expect(r.diagram.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
      const text = serializeErDsl(r.diagram);
      const r2 = parseErDsl(text, r.diagram);
      expect(r2.errors).toEqual([]);
      expect(serializeErDsl(r2.diagram)).toBe(text);
      // Positionen bleiben erhalten
      const pos = (d: typeof r.diagram) => d.nodes.map((n) => `${n.id}:${n.x}:${n.y}`).sort();
      expect(pos(r2.diagram)).toEqual(pos(r.diagram));
    });
  }

  it("erkennt Konstrukte", () => {
    const { diagram } = parseErDsl(EXAMPLES[0].dsl);
    const rec = diagram.nodes.find((n) => n.name === "ist Vorgesetzter von")!;
    const roles = diagram.edges.filter((e) => e.from === rec.id);
    expect(roles.map((e) => [e.card, e.role])).toEqual([["1", "Vorgesetzter"], ["n", "Untergebener"]]);
    const isa = diagram.nodes.find((n) => n.kind === "isa")!;
    expect(isa).toMatchObject({ disjoint: true, total: true });
    expect(diagram.edges.filter((e) => e.kind === "sub")).toHaveLength(3);
  });

  it("meldet Fehler mit Zeile", () => {
    const r = parseErDsl("entity A {\n key x\n}\nfoo bar\nentity B");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(4);
    expect(r.diagram.nodes.filter((n) => n.kind === "entity")).toHaveLength(2);
  });
});

describe("Relationen-DSL", () => {
  it("Round-Trip", () => {
    const src = `table mitarbeiter {\n  id int pk\n  name varchar(100) not null\n  vorgesetzter_id int -> mitarbeiter.id\n}\ntable reinigung {\n  mitarbeiter_id int pk [ref: > mitarbeiter.id]\n  tag varchar(10) unique\n}\n`;
    const r = parseRelDsl(src);
    expect(r.errors).toEqual([]);
    expect(r.schema.tables[1].columns[0]).toMatchObject({ pk: true, ref: { table: "mitarbeiter", column: "id" } });
    const txt = serializeRelDsl(r.schema);
    expect(serializeRelDsl(parseRelDsl(txt).schema)).toBe(txt);
  });
});

describe("Abbildung ER → Relational", () => {
  const tier = parseErDsl(EXAMPLES[0].dsl).diagram;
  const names = (s: InheritanceStrategy) => mapErToRelational(tier, { inheritance: s, sqlNames: true, lowercase: true }).schema.tables.map((t) => t.name);

  it("Tiergarten vertikal", () => {
    const { schema } = mapErToRelational(tier, { inheritance: "vertical", sqlNames: true, lowercase: true });
    const m = schema.tables.find((t) => t.name === "mitarbeiter")!;
    expect(m.columns.find((c) => c.name === "vorgesetzter_id")?.ref).toEqual({ table: "mitarbeiter", column: "mitarbeiter_id" });
    const reinigt = schema.tables.find((t) => t.name === "reinigt")!;
    expect(reinigt.columns.filter((c) => c.pk).map((c) => c.name)).toEqual(["mitarbeiter_id", "gehege_id"]);
    expect(reinigt.columns.some((c) => c.name === "wochentag")).toBe(true);
    const tierT = schema.tables.find((t) => t.name === "tier")!;
    expect(tierT.columns.find((c) => c.name === "gehege_id")).toMatchObject({ notNull: true, ref: { table: "gehege" } });
    const saeuge = schema.tables.find((t) => t.name === "saeugetier")!;
    expect(saeuge.columns[0]).toMatchObject({ name: "tier_id", pk: true, ref: { table: "tier", column: "tier_id" } });
  });

  it("alle Strategien", () => {
    expect(names("single")).not.toContain("vogel");
    expect(names("perSubtype")).not.toContain("tier");
    expect(names("horizontal")).toEqual(expect.arrayContaining(["tier", "vogel"]));
    const single = mapErToRelational(tier, { inheritance: "single", sqlNames: true, lowercase: true }).schema.tables.find((t) => t.name === "tier")!;
    expect(single.columns.some((c) => c.name === "tier_typ")).toBe(true);
    expect(single.columns.some((c) => c.name === "spannweite_cm")).toBe(true);
  });

  it("schwache Entität, mehrwertig, zusammengesetzt", () => {
    const { schema } = mapErToRelational(parseErDsl(EXAMPLES[1].dsl).diagram);
    const raum = schema.tables.find((t) => t.name === "raum")!;
    expect(raum.columns.filter((c) => c.pk).map((c) => c.name)).toEqual(["gebaeude_nr", "raum_nr"]);
    expect(schema.tables.find((t) => t.name === "gebaeude")!.columns.map((c) => c.name)).toEqual(["gebaeude_nr", "name", "strasse", "plz", "ort"]);
    const multi = schema.tables.find((t) => t.name === "raum_ausstattung")!;
    expect(multi.columns.filter((c) => c.pk)).toHaveLength(3);
  });

  it("n-är, (min,max), Aggregation", () => {
    const { schema, warnings } = mapErToRelational(parseErDsl(EXAMPLES.find((e) => e.id === "minmax")!.dsl).diagram);
    expect(schema.tables.find((t) => t.name === "haelt")!.columns.filter((c) => c.ref)).toHaveLength(3);
    const bel = schema.tables.find((t) => t.name === "belegung")!;
    expect(bel.columns.filter((c) => c.pk).map((c) => c.name)).toEqual(["matrikel_nr", "kurs_nr"]);
    const pr = schema.tables.find((t) => t.name === "belegung")!;
    expect(pr).toBeTruthy();
    expect(warnings).toEqual([]);
  });
});

describe("Testdaten", () => {
  for (const s of ["vertical", "horizontal", "perSubtype", "single"] as InheritanceStrategy[]) {
    it(`erzeugt konsistente Daten (${s})`, () => {
      for (const ex of EXAMPLES) {
        const { schema } = mapErToRelational(parseErDsl(ex.dsl).diagram, { inheritance: s, sqlNames: true, lowercase: true });
        const data = generateData(schema, { seed: 1, defaultRows: 15, rows: {}, nullRate: 0.1 });
        for (const t of schema.tables) {
          const rows = data[t.name];
          const pk = t.columns.filter((c) => c.pk);
          const keys = rows.map((r) => JSON.stringify(pk.map((c) => r[c.name])));
          expect(new Set(keys).size).toBe(rows.length);
          for (const c of t.columns) {
            if (c.notNull) expect(rows.every((r) => r[c.name] !== null)).toBe(true);
            if (c.ref) {
              const target = new Set(data[c.ref.table].map((r) => r[c.ref!.column]));
              expect(rows.every((r) => r[c.name] === null || target.has(r[c.name]))).toBe(true);
            }
          }
        }
        expect(datasetToSql(schema, data)).toContain("INSERT INTO");
        expect(schemaToSql(schema)).toContain("CREATE TABLE");
      }
    });
  }
});

describe("Zuordnung beim Umbenennen im Code", () => {
  it("behält ID und Position", () => {
    const a = parseErDsl("entity Tier {\n  key id\n  name\n}\n").diagram;
    const b = parseErDsl("entity Tiere {\n  key id\n  name2\n}\n", a).diagram;
    const pos = (d: typeof a) => d.nodes.map((n) => `${n.id}:${n.x}:${n.y}`).sort();
    expect(pos(b)).toEqual(pos(a));
  });
});

describe("Fälle aus den Unterlagen", () => {
  it("schwache Entität mit mehreren Besitzern und Kaskade", () => {
    const src = `entity A { key a }\nentity C { key c }\nweak entity B { partial b }\nweak entity D { partial d }\nidentifying relationship r1 (A 1, B n total)\nidentifying relationship r2 (C 1, B n total)\nidentifying relationship r3 (B 1, D n total)\n`;
    const { schema } = mapErToRelational(parseErDsl(src).diagram);
    const pk = (n: string) => schema.tables.find((t) => t.name === n)!.columns.filter((c) => c.pk).map((c) => c.name);
    expect(pk("b")).toEqual(["a", "c", "b"]);
    expect(pk("d")).toEqual(["a", "c", "b", "d"]);
  });
  it("Horizontal Mapping: B(id→A, a1, b1)", () => {
    const { schema } = mapErToRelational(parseErDsl(EXAMPLES[2].dsl).diagram, { inheritance: "horizontal", sqlNames: true, lowercase: true });
    const st = schema.tables.find((t) => t.name === "student")!;
    expect(st.columns.map((c) => c.name)).toEqual(["id", "name", "geburtsjahr", "matrikelnummer"]);
    expect(st.columns[0].ref).toEqual({ table: "person", column: "id" });
  });
});

it("Beispiel Rechnungsposition: zusammengesetzte Schlüssel", () => {
  const { schema } = mapErToRelational(parseErDsl(EXAMPLES.find((e) => e.id === "weak-cascade")!.dsl).diagram);
  const pk = (n: string) => schema.tables.find((t) => t.name === n)!.columns.filter((c) => c.pk).map((c) => c.name);
  expect(pk("position")).toEqual(["rechnung_nr", "artikel_nr", "pos_nr"]);
  expect(pk("lieferung")).toEqual(["rechnung_nr", "artikel_nr", "pos_nr", "lieferung_nr"]);
});

describe("Update-Prüfung", () => {
  const rel = (tag: string, prerelease = false, draft = false) => ({ tag_name: tag, html_url: `https://github.com/gigafrosxh/erd-ultra/releases/tag/${tag}`, prerelease, draft });

  it("vergleicht Versionen nach SemVer", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0-beta.2", "0.2.0-beta.10")).toBeLessThan(0);
    expect(compareVersions("0.2.0", "0.2.0-rc.1")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0-beta.3", "0.2.0-rc.1")).toBeLessThan(0);
    expect(compareVersions("v1.0.0", "1.0.0")).toBe(0);
  });

  it("stabile Versionen sehen nur stabile Releases", () => {
    const list = [rel("v0.3.0-beta.1", true), rel("v0.2.1"), rel("v0.1.1"), rel("v0.4.0", false, true)];
    expect(pickUpdate(list, "0.2.0")?.version).toBe("0.2.1");
    expect(pickUpdate(list, "0.2.1")).toBeNull();
  });

  it("Beta-Versionen sehen auch neuere Pre-Releases und die fertige Version", () => {
    expect(pickUpdate([rel("v0.2.0-beta.2", true), rel("v0.1.1")], "0.2.0-beta.1")?.version).toBe("0.2.0-beta.2");
    expect(pickUpdate([rel("v0.2.0-beta.2", true), rel("v0.2.0")], "0.2.0-beta.1")?.version).toBe("0.2.0");
  });
});
