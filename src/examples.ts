// Mitgelieferte Beispiele

export const EXAMPLES: { id: string; title: string; dsl: string }[] = [
  {
    id: "tiergarten",
    title: "Tiergarten (Chen, Spezialisierung, rekursiv)",
    dsl: `# ER-Diagramm Tiergarten
entity Mitarbeiter {
  key mitarbeiter_id: int
  vorname: varchar(50)
  nachname: varchar(50)
  funktion: varchar(50)
  eintrittsdatum: date
}

entity Gehege {
  key gehege_id: int
  bezeichnung: varchar(50)
  flaeche_m2: decimal(8,2)
  klimazone: varchar(30)
}

entity Tier {
  key tier_id: int
  name: varchar(50)
  art: varchar(50)
  geburtsdatum: date
  geschlecht: char(1)
}

entity Säugetier { fellart: varchar(30), tragzeit_tage: smallint }
entity Vogel { spannweite_cm: smallint, flugfaehig: boolean }
entity Reptil { min_temperatur_c: decimal(4,1), giftig: boolean }

relationship "ist Vorgesetzter von" (Mitarbeiter 1 as Vorgesetzter, Mitarbeiter n as Untergebener)
relationship leitet (Mitarbeiter 1, Gehege n)
relationship reinigt (Mitarbeiter m, Gehege n) { wochentag: tinyint }
relationship "lebt in" (Gehege 1, Tier n total)

isa Tier disjoint total { Säugetier, Vogel, Reptil }
`,
  },
  {
    id: "weak",
    title: "Schwache Entität (Gebäude / Raum)",
    dsl: `entity Gebäude {
  key gebaeude_nr: int
  name
  adresse { strasse, plz, ort }
}

weak entity Raum {
  partial raum_nr: int
  kapazitaet: int
  multi ausstattung
}

identifying relationship hat (Gebäude 1, Raum n total)
`,
  },
  {
    id: "person",
    title: "Generalisierung (Person / Student / Mitarbeiter)",
    dsl: `entity Person {
  key id: int
  name
  geburtsjahr: int
  derived alter
}
entity Student { matrikelnummer: int }
entity Mitarbeiter { gehalt: decimal(10,2) }

isa Person overlapping partial { Student, Mitarbeiter }
`,
  },
  {
    id: "sportler",
    title: "Sportler (Typhierarchie aus der Vorlesung)",
    dsl: `entity Spieler {
  key id: int
  name
  groesse_cm: int
  gewicht_kg: int
  geschlecht: char(1)
}
entity Tennisspieler { spielhand: char(1), typ }
entity Fussballer { position, starker_fuss: char(1) }
entity Golfer { handicap: decimal(3,1) }
entity Langlaeufer { skating_skills: int, klassisch_skills: int }
entity Alpinskifahrer
entity Disziplin { key did: int, bezeichnung }

isa Spieler overlapping partial { Tennisspieler, Fussballer, Golfer, Langlaeufer, Alpinskifahrer }
relationship "startet in" (Alpinskifahrer (1,n), Disziplin (0,n))
`,
  },
  {
    id: "weak-cascade",
    title: "Schwache Entitäten: mehrere Besitzer & Kaskade",
    dsl: `# B(a#, c#, b) und D(a#, c#, b#, d)
entity Rechnung { key rechnung_nr: int, datum: date }
entity Artikel { key artikel_nr: int, bezeichnung, preis: decimal(10,2) }
weak entity Position { partial pos_nr: int, menge: int }
weak entity Lieferung { partial lieferung_nr: int, lieferdatum: date }

identifying relationship enthaelt (Rechnung (0,n), Position (1,1))
identifying relationship betrifft (Artikel (0,n), Position (1,1))
identifying relationship "wird geliefert" (Position (0,n), Lieferung (1,1))
`,
  },
  {
    id: "minmax",
    title: "(min,max)-Notation, n-äre Beziehung, Aggregation",
    dsl: `entity Dozent { key dozent_nr: int, name }
entity Kurs { key kurs_nr: int, titel }
entity Raum { key raum_nr: int, plaetze: int }
entity Student { key matrikel_nr: int, name }

# ternäre Beziehung
relationship "hält" (Dozent (0,n), Kurs (1,n), Raum (0,n)) { wochentag, uhrzeit: time }

# Aggregation: Belegung als assoziative Entität
associative entity Belegung (Student (0,n), Kurs (0,n)) { semester }
entity Prüfung { key pruefung_nr: int, datum: date, note: decimal(2,1) }
relationship "wird geprüft" (Belegung (0,1), Prüfung (1,1))
`,
  },
];
