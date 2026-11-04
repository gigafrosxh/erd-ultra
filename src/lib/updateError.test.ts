import { describe, expect, it } from "vitest";
import { explainUpdateError } from "./platform";

describe("explainUpdateError", () => {
  it("erklärt ein schreibgeschütztes Laufwerk und behält die Originalmeldung", () => {
    const out = explainUpdateError("Read-only file system (os error 30)");
    expect(out).toContain("schreibgeschützten Ort");
    expect(out).toContain("Technische Meldung: Read-only file system (os error 30)");
  });
  it("erklärt eine abgebrochene Passwortabfrage", () => {
    expect(explainUpdateError("Failed to move the new app into place")).toContain("Administratorrechte");
  });
  it("lässt unbekannte Meldungen unverändert", () => {
    expect(explainUpdateError("irgendwas")).toBe("irgendwas");
  });
});
