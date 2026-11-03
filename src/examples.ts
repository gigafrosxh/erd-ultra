// Einziges mitgeliefertes Beispiel: bewusst klein gehalten

export const SIMPLE_EXAMPLE = `# Einfaches Beispiel
entity Kunde {
  key kunden_nr: int
  name: varchar(100)
}

entity Bestellung {
  key bestell_nr: int
  datum: date
}

relationship gibt (Kunde 1, Bestellung n total)
`;
