// Regressionstests für die Issues #18–#25
import { describe, expect, it } from "vitest";
import { keepComments, parseErDsl, serializeErDsl } from "../src/er/dsl";
import { parseRelDsl, serializeRelDsl } from "../src/rel/dsl";
import { schemaToSql } from "../src/rel/sql";
import { guessType } from "../src/rel/model";
import { defaultGenOptions, generateData } from "../src/data/generator";
import { tokenize } from "../src/lib/lexer";
import type { ErDiagram } from "../src/er/model";

const roundTrip = (d: ErDiagram) => parseErDsl(serializeErDsl(d), d);

describe("Issues #18–#25", () => {
  it("#18: Kardinalität 0,n ohne Klammern übersteht den Round-Trip", () => {
    const { diagram } = parseErDsl("entity A\nentity B\nrelationship r (A 1, B n)");
    const rel = diagram.nodes.find((n) => n.kind === "relationship")!;
    const edge = diagram.edges.find((e) => e.from === rel.id && e.card === "n")!;
    edge.card = "0,n"; // freier Text aus dem Eigenschaften-Panel
    const r = roundTrip(diagram);
    expect(r.errors).toEqual([]);
    expect(r.diagram.nodes.filter((n) => n.kind === "entity").map((n) => n.name)).toEqual(["A", "B"]);
    const roles = r.diagram.edges.filter((e) => e.kind === "role");
    expect(roles.map((e) => e.card)).toEqual(["1", "(0,n)"]);
    // weiterer Round-Trip bleibt stabil
    expect(serializeErDsl(roundTrip(r.diagram).diagram)).toBe(serializeErDsl(r.diagram));
  });

  it("#19: Fehler in einem Attribut-Block verwirft keine weiteren Attribute", () => {
    const r = parseErDsl("entity X {\n  a: int(\n  key b\n  name\n}\nentity Y { c }");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(2);
    const names = r.diagram.nodes.map((n) => n.name);
    expect(names).toEqual(expect.arrayContaining(["X", "b", "name", "Y", "c"]));
    expect(r.diagram.nodes.find((n) => n.name === "b")).toMatchObject({ attrKind: "key" });
  });

  it("#19: Fehler auf oberster Ebene setzt bei specialization wieder auf", () => {
    const r = parseErDsl("entity A\nfoo bar\nspecialization A { B }");
    expect(r.errors).toHaveLength(1);
    expect(r.diagram.nodes.some((n) => n.kind === "isa")).toBe(true);
  });

  it("#19: Fehler mitten in einem Block springt nicht in den Block zurück", () => {
    const r = parseErDsl("isa T {\n  S\n  (\n  entity\n}\nentity Z");
    expect(r.errors).toHaveLength(1);
    expect(r.diagram.nodes.some((n) => n.name === "Z")).toBe(true);
  });

  it("#20: mehrzeilige Tabellennotiz ergibt gültige Kommentare im SQL", () => {
    const { schema, errors } = parseRelDsl('table t "zeile1\\nzeile2" { id int pk }');
    expect(errors).toEqual([]);
    expect(schema.tables[0].note).toBe("zeile1\nzeile2");
    const sql = schemaToSql(schema);
    expect(sql).toContain("-- zeile1\n-- zeile2\nCREATE TABLE");
    for (const line of sql.split("\n")) if (line.includes("zeile")) expect(line.startsWith("--")).toBe(true);
  });

  it("#21: Telefonnummer und PLZ werden als Text angelegt", () => {
    for (const n of ["telefonnummer", "handynummer", "telefon_nr", "tel", "fax", "kunde_telefon"]) expect(guessType(n)).toBe("varchar(30)");
    for (const n of ["plz", "kunde_plz", "postleitzahl"]) expect(guessType(n)).toBe("varchar(10)");
    expect(guessType("titel")).toBe("varchar(100)");
    expect(guessType("kunden_nr")).toBe("int");
    const schema = {
      tables: [
        {
          id: "t",
          name: "kunde",
          x: 0,
          y: 0,
          columns: [
            { name: "id", type: "int", pk: true },
            { name: "telefonnummer", type: guessType("telefonnummer") },
            { name: "plz", type: guessType("plz") },
            { name: "titel", type: "varchar(100)" },
          ],
        },
      ],
    };
    const rows = generateData(schema, { ...defaultGenOptions, defaultRows: 20, nullRate: 0 }).kunde as Record<string, unknown>[];
    for (const row of rows) {
      expect(row.telefonnummer).toMatch(/^\+49 \d+ \d+$/);
      expect(row.plz).toMatch(/^\d{5}$/);
      expect(row.titel).not.toMatch(/^\+49/);
    }
  });

  it("#22: lose Attribute behalten ihren Datentyp", () => {
    const r = parseErDsl("attribute preis: decimal(10,2)");
    const text = serializeErDsl(r.diagram);
    expect(text).toContain("attribute preis: decimal(10,2)");
    expect(roundTrip(r.diagram).diagram.nodes[0]).toMatchObject({ dataType: "decimal(10,2)" });
  });

  it("#23: isa-Label mit Anführungszeichen wird maskiert", () => {
    const { diagram } = parseErDsl("isa T disjoint total { S }");
    diagram.nodes.find((n) => n.kind === "isa")!.name = 'a"b';
    const r = roundTrip(diagram);
    expect(r.errors).toEqual([]);
    expect(r.diagram.nodes.find((n) => n.kind === "isa")!.name).toBe('a"b');
  });

  it("#23: Oberklasse namens d/o/partiell bleibt erhalten", () => {
    for (const sup of ["d", "o", "disjunkt", "partiell", "überlappend"]) {
      const { diagram } = parseErDsl(`entity "${sup}"\nisa "${sup}" disjoint total { S }`);
      const r = roundTrip(diagram);
      expect(r.errors).toEqual([]);
      const supEdge = r.diagram.edges.find((e) => e.kind === "super");
      expect(supEdge, sup).toBeDefined();
      expect(r.diagram.nodes.find((n) => n.id === supEdge!.from)!.name).toBe(sup);
    }
  });

  it("#24: Tab und Unicode in Notizen überstehen den Round-Trip", () => {
    const text = "a\tb é \u0001 \"q\" \\ \u{1F600}";
    const er = parseErDsl(`note ${JSON.stringify(text)}`);
    expect(er.diagram.nodes[0].name).toBe(text);
    expect(roundTrip(er.diagram).diagram.nodes[0].name).toBe(text);
    const rel = parseRelDsl('table t { id int pk }').schema;
    rel.tables[0].note = text;
    rel.tables[0].columns[0].note = text;
    const back = parseRelDsl(serializeRelDsl(rel)).schema;
    expect(back.tables[0].note).toBe(text);
    expect(back.tables[0].columns[0].note).toBe(text);
  });

  it("#25: Block-Kommentare bleiben nach grafischer Änderung erhalten", () => {
    const old = "/* Kopf\n   zweite Zeile */\nentity A {\n  /* zum Attribut */\n  x\n}\n";
    const { diagram } = parseErDsl(old);
    const out = keepComments(old, serializeErDsl(diagram));
    expect(out).toContain("/* Kopf\n   zweite Zeile */\nentity A");
    expect(out).toContain("  /* zum Attribut */\n  x");
    expect(parseErDsl(out).errors).toEqual([]);
  });

  it("#25: nicht geschlossenes /* wird als Fehler gemeldet", () => {
    const errs: unknown[] = [];
    tokenize("entity A\n/* offen\nentity B", errs as never);
    expect(errs).toHaveLength(1);
    const r = parseErDsl("entity A\n/* offen\nentity B");
    expect(r.errors.map((e) => [e.line, e.message])).toEqual([[2, expect.stringContaining("Kommentar")]]);
  });

  it("nicht geschlossene Zeichenkette wird gemeldet statt geworfen", () => {
    const r = parseErDsl('entity A\nnote "offen\nentity B');
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.diagram.nodes.some((n) => n.name === "B")).toBe(true);
  });
});
