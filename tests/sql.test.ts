import { describe, expect, it } from "vitest";
import { datasetToSql, generateData } from "../src/data/generator";
import { parseErDsl } from "../src/er/dsl";
import { mapErToRelational } from "../src/rel/mapping";
import { parseRelDsl } from "../src/rel/dsl";
import { mapType, quoteIdent, schemaToSql } from "../src/rel/sql";
import { EXAMPLES } from "./fixtures";

describe("SQL-Dialekte", () => {
  it("übersetzt Datentypen", () => {
    expect(mapType("tinyint", "postgres")).toBe("SMALLINT");
    expect(mapType("datetime", "postgres")).toBe("TIMESTAMP");
    expect(mapType("double", "postgres")).toBe("DOUBLE PRECISION");
    expect(mapType("boolean", "sqlserver")).toBe("BIT");
    expect(mapType("text", "sqlserver")).toBe("NVARCHAR(MAX)");
    expect(mapType("boolean", "mysql")).toBe("TINYINT(1)");
    expect(mapType("varchar(50)", "postgres")).toBe("VARCHAR(50)");
    expect(mapType("serial", "sqlite")).toBe("INTEGER");
  });

  it("maskiert reservierte Wörter je Dialekt", () => {
    expect(quoteIdent("order", "postgres")).toBe('"order"');
    expect(quoteIdent("order", "mysql")).toBe("`order`");
    expect(quoteIdent("user", "sqlserver")).toBe("[user]");
    expect(quoteIdent("kunde", "postgres")).toBe("kunde");
    const { schema } = parseRelDsl("table order {\n  id int pk\n  date date\n}\n");
    expect(schemaToSql(schema, "postgres")).toContain('CREATE TABLE "order" (\n  id INT NOT NULL,\n  "date" DATE');
  });

  it("Testdaten-INSERTs passen zum Dialekt", () => {
    const { schema } = parseRelDsl("table tier {\n  id int pk\n  giftig boolean not null\n}\n");
    const data = generateData(schema, { seed: 1, defaultRows: 3, rows: {}, nullRate: 0 });
    expect(datasetToSql(schema, data, "sqlserver")).not.toMatch(/TRUE|FALSE/);
    expect(datasetToSql(schema, data, "postgres")).toMatch(/TRUE|FALSE/);
  });
});

describe("Testdaten-Wertebereiche", () => {
  it("hält decimal(p,s) und tinyint ein", () => {
    const { schema } = parseRelDsl("table t {\n  id int pk\n  wert decimal(2,1)\n  gehalt decimal(4,2)\n  stufe tinyint\n}\n");
    const rows = generateData(schema, { seed: 3, defaultRows: 200, rows: {}, nullRate: 0 }).t;
    for (const r of rows) {
      expect(Math.abs(r.wert as number)).toBeLessThanOrEqual(9.9);
      expect(Math.abs(r.gehalt as number)).toBeLessThanOrEqual(99.99);
      expect(r.stufe as number).toBeLessThanOrEqual(127);
      expect(String(r.wert)).toMatch(/^\d(\.\d)?$/);
    }
  });

  it("disjunkte Untertabellen teilen sich keine Obertyp-Datensätze", () => {
    const { schema } = mapErToRelational(parseErDsl(EXAMPLES[0].dsl).diagram, { inheritance: "vertical", sqlNames: true, lowercase: true });
    const data = generateData(schema, { seed: 5, defaultRows: 10, rows: {}, nullRate: 0.1 });
    const ids = ["saeugetier", "vogel", "reptil"].flatMap((t) => data[t].map((r) => r.tier_id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(data.tier.length);
  });
});
