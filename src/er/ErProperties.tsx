// Eigenschaften-Panel für das ausgewählte ER-Element.

import { Icon } from "../ui/Icon";
import { placeAttributes } from "./layout";
import { type AttrKind, type ErDiagram, type ErEdge, type ErNode, nodeSize, uid } from "./model";

interface Props {
  diagram: ErDiagram;
  selNodes: Set<string>;
  selEdge: string | null;
  onChange: (d: ErDiagram, mergeKey?: string) => void;
  select: (nodes: string[], edge?: string | null) => void;
  onDelete: () => void;
  onAutoLayout: () => void;
}

const CARD_PRESETS = ["1", "n", "m", "(0,1)", "(1,1)", "(0,n)", "(1,n)"];

export function ErProperties({ diagram, selNodes, selEdge, onChange, select, onDelete, onAutoLayout }: Props) {
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const patchNode = (id: string, patch: Partial<ErNode>, key?: string) =>
    onChange({ ...diagram, nodes: diagram.nodes.map((n) => (n.id === id ? ({ ...n, ...patch } as ErNode) : n)) }, key);
  const patchEdge = (id: string, patch: Partial<ErEdge>, key?: string) =>
    onChange({ ...diagram, edges: diagram.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) }, key);

  const addAttribute = (owner: ErNode, attrKind: AttrKind = "normal") => {
    const count = diagram.edges.filter((e) => e.kind === "attr" && e.to === owner.id).length;
    const a: ErNode = { kind: "attribute", id: uid(), name: attrKind === "key" ? "id" : `attribut${count + 1}`, x: NaN, y: NaN, attrKind };
    const d: ErDiagram = { ...diagram, nodes: [...diagram.nodes, a], edges: [...diagram.edges, { id: uid("e"), kind: "attr", from: a.id, to: owner.id }] };
    const copy = structuredClone(d);
    placeAttributes(copy, owner.id, true);
    onChange(copy);
    select([a.id]);
  };

  const entities = diagram.nodes.filter((n) => n.kind === "entity");

  if (selEdge) {
    const e = diagram.edges.find((x) => x.id === selEdge);
    if (!e) return null;
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    return (
      <div className="props">
        <h3>{e.kind === "role" ? "Teilnahme" : e.kind === "attr" ? "Attribut-Verbindung" : e.kind === "super" ? "Oberklasse → Spezialisierung" : "Spezialisierung → Unterklasse"}</h3>
        <p className="muted small">
          {from?.name} — {to?.name}
        </p>
        {e.kind === "role" && (
          <>
            <label className="field">
              <span>Kardinalität</span>
              <input value={e.card ?? ""} placeholder="z.B. 1, n, (0,n)" onChange={(ev) => patchEdge(e.id, { card: ev.target.value || undefined }, `card-${e.id}`)} />
            </label>
            <div className="chips">
              {CARD_PRESETS.map((c) => (
                <button key={c} className={`chip ${e.card === c ? "on" : ""}`} onClick={() => patchEdge(e.id, { card: c })}>
                  {c}
                </button>
              ))}
            </div>
            <label className="field">
              <span>Rolle</span>
              <input value={e.role ?? ""} placeholder="optional, z.B. Vorgesetzter" onChange={(ev) => patchEdge(e.id, { role: ev.target.value || undefined }, `role-${e.id}`)} />
            </label>
            <label className="check">
              <input type="checkbox" checked={!!e.total} onChange={(ev) => patchEdge(e.id, { total: ev.target.checked || undefined })} />
              Totale Teilnahme (Doppellinie)
            </label>
          </>
        )}
        {e.kind === "super" && (
          <label className="check">
            <input
              type="checkbox"
              checked={!!e.total}
              onChange={(ev) => {
                const total = ev.target.checked;
                onChange({
                  ...diagram,
                  edges: diagram.edges.map((x) => (x.id === e.id ? { ...x, total: total || undefined } : x)),
                  nodes: diagram.nodes.map((n) => (n.id === e.to && n.kind === "isa" ? { ...n, total } : n)),
                });
              }}
            />
            Totale Spezialisierung (Doppellinie)
          </label>
        )}
        <div className="row-actions">
          <button className="btn danger" onClick={onDelete}>
            <Icon name="trash" size={16} /> Verbindung löschen
          </button>
        </div>
      </div>
    );
  }

  if (selNodes.size > 1) {
    return (
      <div className="props">
        <h3>{selNodes.size} Elemente ausgewählt</h3>
        <p className="muted small">Ziehen verschiebt alle. Entf löscht sie.</p>
        <div className="row-actions">
          <button className="btn danger" onClick={onDelete}>
            <Icon name="trash" size={16} /> Auswahl löschen
          </button>
        </div>
      </div>
    );
  }

  const n = selNodes.size === 1 ? byId.get([...selNodes][0]) : undefined;
  if (!n) {
    return (
      <div className="props">
        <h3>Diagramm</h3>
        <p className="muted small">
          {diagram.nodes.filter((x) => x.kind === "entity").length} Entitäten · {diagram.nodes.filter((x) => x.kind === "relationship").length} Beziehungen ·{" "}
          {diagram.nodes.filter((x) => x.kind === "attribute").length} Attribute
        </p>
        <label className="check">
          <input type="checkbox" checked={!!diagram.showLegend} onChange={(ev) => onChange({ ...diagram, showLegend: ev.target.checked })} />
          Legende anzeigen
        </label>
        <div className="row-actions">
          <button className="btn" onClick={onAutoLayout}>
            <Icon name="layout" size={16} /> Automatisch anordnen
          </button>
        </div>
        <div className="hints">
          <b>Tipps</b>
          <ul>
            <li>Doppelklick auf freie Fläche: neue Entität</li>
            <li>Doppelklick auf Element: umbenennen</li>
            <li>Am blauen <b>+</b> ziehen: verbinden</li>
            <li>Werkzeug wählen und auf eine Entität klicken: direkt anhängen</li>
            <li>Freie Fläche ziehen oder Shift + Rad: verschieben, Scrollen: Zoom</li>
            <li>Shift + Ziehen: Mehrfachauswahl</li>
          </ul>
        </div>
      </div>
    );
  }

  const nameField = (
    <label className="field">
      <span>Name</span>
      {n.kind === "note" ? (
        <textarea rows={4} value={n.name} onChange={(ev) => patchNode(n.id, { name: ev.target.value }, `name-${n.id}`)} />
      ) : (
        <input value={n.name} onChange={(ev) => patchNode(n.id, { name: ev.target.value }, `name-${n.id}`)} />
      )}
    </label>
  );

  const attrs = diagram.edges.filter((e) => e.kind === "attr" && e.to === n.id).map((e) => byId.get(e.from)!).filter(Boolean);
  const attrList = attrs.length > 0 && (
    <div className="mini-list">
      {attrs.map((a) => (
        <button key={a.id} className="mini-item" onClick={() => select([a.id])}>
          <span className={a.kind === "attribute" && a.attrKind === "key" ? "u" : a.kind === "attribute" && a.attrKind === "partial" ? "u-dash" : ""}>{a.name}</span>
          {a.kind === "attribute" && a.attrKind !== "normal" && <em>{ATTR_LABEL[a.attrKind]}</em>}
        </button>
      ))}
    </div>
  );

  const addAttrButtons = (
    <div className="row-actions wrap">
      <button className="btn" onClick={() => addAttribute(n)}>
        <Icon name="plus" size={15} /> Attribut
      </button>
      {n.kind === "entity" && (
        <button className="btn" onClick={() => addAttribute(n, n.weak ? "partial" : "key")}>
          <Icon name="key" size={15} /> {n.weak ? "Teilschlüssel" : "Schlüssel"}
        </button>
      )}
    </div>
  );

  let body: React.ReactNode = null;
  switch (n.kind) {
    case "entity":
      body = (
        <>
          <div className="seg">
            {(["normal", "weak", "associative"] as const).map((k) => {
              const on = k === "weak" ? !!n.weak : k === "associative" ? !!n.associative : !n.weak && !n.associative;
              return (
                <button key={k} className={on ? "on" : ""} onClick={() => patchNode(n.id, { weak: k === "weak" || undefined, associative: k === "associative" || undefined })}>
                  {k === "normal" ? "Stark" : k === "weak" ? "Schwach" : "Aggregation"}
                </button>
              );
            })}
          </div>
          {attrList}
          {addAttrButtons}
          {n.associative && <Participants diagram={diagram} owner={n} onChange={onChange} select={select} />}
          <SubclassInfo diagram={diagram} node={n} />
        </>
      );
      break;
    case "relationship":
      body = (
        <>
          <label className="check">
            <input type="checkbox" checked={!!n.identifying} onChange={(ev) => patchNode(n.id, { identifying: ev.target.checked || undefined })} />
            Identifizierende Beziehung (für schwache Entität)
          </label>
          <Participants diagram={diagram} owner={n} onChange={onChange} select={select} />
          {attrList}
          {addAttrButtons}
        </>
      );
      break;
    case "attribute": {
      const owner = diagram.edges.find((e) => e.kind === "attr" && e.from === n.id);
      body = (
        <>
          <label className="field">
            <span>Art</span>
            <select value={n.attrKind} onChange={(ev) => patchNode(n.id, { attrKind: ev.target.value as AttrKind })}>
              {Object.entries(ATTR_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Datentyp</span>
            <input value={n.dataType ?? ""} placeholder="automatisch (z.B. int, varchar(50), date)" onChange={(ev) => patchNode(n.id, { dataType: ev.target.value || undefined }, `type-${n.id}`)} />
          </label>
          <label className="field">
            <span>Gehört zu</span>
            <select
              value={owner?.to ?? ""}
              onChange={(ev) => {
                const edges = diagram.edges.filter((e) => !(e.kind === "attr" && e.from === n.id));
                if (ev.target.value) edges.push({ id: uid("e"), kind: "attr", from: n.id, to: ev.target.value });
                onChange({ ...diagram, edges });
              }}
            >
              <option value="">– keinem –</option>
              {diagram.nodes
                .filter((m) => m.id !== n.id && (m.kind === "entity" || m.kind === "relationship" || m.kind === "attribute"))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.kind === "entity" ? "Entität" : m.kind === "relationship" ? "Beziehung" : "Attribut"})
                  </option>
                ))}
            </select>
          </label>
          {attrs.length > 0 && <p className="muted small">Zusammengesetztes Attribut aus:</p>}
          {attrList}
          <div className="row-actions">
            <button className="btn" onClick={() => addAttribute(n)}>
              <Icon name="plus" size={15} /> Teilattribut (zusammengesetzt)
            </button>
          </div>
        </>
      );
      break;
    }
    case "isa": {
      const sup = diagram.edges.find((e) => e.kind === "super" && e.to === n.id);
      const subs = diagram.edges.filter((e) => e.kind === "sub" && e.from === n.id);
      const setSuper = (id: string) => {
        const edges = diagram.edges.filter((e) => !(e.kind === "super" && e.to === n.id));
        if (id) edges.push({ id: uid("e"), kind: "super", from: id, to: n.id, total: n.total || undefined });
        onChange({ ...diagram, edges });
      };
      const addSub = (id: string) => {
        if (id === "__new") {
          const s = byId.get(sup?.from ?? "");
          const ent: ErNode = { kind: "entity", id: uid(), name: `Unterklasse${subs.length + 1}`, x: n.x + (subs.length - 1) * 170, y: n.y + 120 };
          onChange({ ...diagram, nodes: [...diagram.nodes, ent], edges: [...diagram.edges, { id: uid("e"), kind: "sub", from: n.id, to: ent.id }] });
          void s;
          select([ent.id]);
          return;
        }
        if (id) onChange({ ...diagram, edges: [...diagram.edges, { id: uid("e"), kind: "sub", from: n.id, to: id }] });
      };
      body = (
        <>
          <div className="seg">
            <button className={n.disjoint ? "on" : ""} onClick={() => patchNode(n.id, { disjoint: true, name: n.name === "o" ? "d" : n.name })}>
              disjunkt (d)
            </button>
            <button className={!n.disjoint ? "on" : ""} onClick={() => patchNode(n.id, { disjoint: false, name: n.name === "d" ? "o" : n.name })}>
              überlappend (o)
            </button>
          </div>
          <div className="seg">
            <button
              className={n.total ? "on" : ""}
              onClick={() =>
                onChange({
                  ...diagram,
                  nodes: diagram.nodes.map((m) => (m.id === n.id ? { ...m, total: true } : m)),
                  edges: diagram.edges.map((e) => (e.kind === "super" && e.to === n.id ? { ...e, total: true } : e)),
                })
              }
            >
              total
            </button>
            <button
              className={!n.total ? "on" : ""}
              onClick={() =>
                onChange({
                  ...diagram,
                  nodes: diagram.nodes.map((m) => (m.id === n.id ? { ...m, total: false } : m)),
                  edges: diagram.edges.map((e) => (e.kind === "super" && e.to === n.id ? { ...e, total: undefined } : e)),
                })
              }
            >
              partiell
            </button>
          </div>
          <label className="field">
            <span>Oberklasse</span>
            <select value={sup?.from ?? ""} onChange={(ev) => setSuper(ev.target.value)}>
              <option value="">– wählen –</option>
              {entities.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>Unterklassen</span>
            <div className="mini-list">
              {subs.map((e) => (
                <div key={e.id} className="mini-item">
                  <span>{byId.get(e.to)?.name}</span>
                  <button className="icon-btn" title="Entfernen" onClick={() => onChange({ ...diagram, edges: diagram.edges.filter((x) => x.id !== e.id) })}>
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
            </div>
            <select value="" onChange={(ev) => addSub(ev.target.value)}>
              <option value="">+ Unterklasse hinzufügen…</option>
              <option value="__new">Neue Entität</option>
              {entities
                .filter((m) => m.id !== sup?.from && !subs.some((s) => s.to === m.id))
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
            </select>
          </div>
        </>
      );
      break;
    }
    case "note":
      body = null;
  }

  return (
    <div className="props">
      <h3>{KIND_LABEL[n.kind]}</h3>
      {n.kind !== "isa" && nameField}
      {body}
      <div className="row-actions">
        <button className="btn danger" onClick={onDelete}>
          <Icon name="trash" size={16} /> Löschen
        </button>
      </div>
      <p className="muted tiny">
        Position {Math.round(n.x)}, {Math.round(n.y)} · {Math.round(nodeSize(n).w)}×{Math.round(nodeSize(n).h)}
      </p>
    </div>
  );
}

function Participants({ diagram, owner, onChange, select }: { diagram: ErDiagram; owner: ErNode; onChange: Props["onChange"]; select: Props["select"] }) {
  const byId = new Map(diagram.nodes.map((n) => [n.id, n]));
  const roles = diagram.edges.filter((e) => e.kind === "role" && e.from === owner.id);
  const patch = (id: string, p: Partial<ErEdge>, key?: string) => onChange({ ...diagram, edges: diagram.edges.map((e) => (e.id === id ? { ...e, ...p } : e)) }, key);
  const candidates = diagram.nodes.filter((n) => n.kind === "entity" && n.id !== owner.id && (owner.kind === "relationship" || !n.associative));
  return (
    <div className="field">
      <span>Teilnehmer ({roles.length})</span>
      <div className="participants">
        {roles.map((e) => (
          <div key={e.id} className="participant">
            <button className="link" onClick={() => select([], e.id)} title="Verbindung auswählen">
              {byId.get(e.to)?.name}
            </button>
            <input className="card-in" value={e.card ?? ""} placeholder="Kard." title="Kardinalität" onChange={(ev) => patch(e.id, { card: ev.target.value || undefined }, `card-${e.id}`)} />
            <input className="role-in" value={e.role ?? ""} placeholder="Rolle" title="Rollenname" onChange={(ev) => patch(e.id, { role: ev.target.value || undefined }, `role-${e.id}`)} />
            <label className="tiny-check" title="Totale Teilnahme">
              <input type="checkbox" checked={!!e.total} onChange={(ev) => patch(e.id, { total: ev.target.checked || undefined })} />
              total
            </label>
            <button className="icon-btn" title="Entfernen" onClick={() => onChange({ ...diagram, edges: diagram.edges.filter((x) => x.id !== e.id) })}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
      <select
        value=""
        onChange={(ev) => {
          if (!ev.target.value) return;
          onChange({ ...diagram, edges: [...diagram.edges, { id: uid("e"), kind: "role", from: owner.id, to: ev.target.value, card: "n" }] });
        }}
      >
        <option value="">+ Teilnehmer hinzufügen…</option>
        {candidates.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function SubclassInfo({ diagram, node }: { diagram: ErDiagram; node: ErNode }) {
  const parentIsa = diagram.edges.find((e) => e.kind === "sub" && e.to === node.id);
  if (!parentIsa) return null;
  const sup = diagram.edges.find((e) => e.kind === "super" && e.to === parentIsa.from);
  const s = diagram.nodes.find((n) => n.id === sup?.from);
  return <p className="muted small">Unterklasse von {s?.name ?? "?"}</p>;
}

export const ATTR_LABEL: Record<AttrKind, string> = {
  normal: "Einfach",
  key: "Schlüssel",
  partial: "Teilschlüssel (schwach)",
  multivalued: "Mehrwertig",
  derived: "Abgeleitet",
};

const KIND_LABEL: Record<ErNode["kind"], string> = {
  entity: "Entität",
  relationship: "Beziehung",
  attribute: "Attribut",
  isa: "Generalisierung / Spezialisierung",
  note: "Notiz",
};
