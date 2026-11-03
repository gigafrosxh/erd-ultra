import { it } from "vitest";
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { parseErDsl } from "../src/er/dsl";
import { ErExportSvg, LIGHT } from "../src/er/ErSvg";
import { RelExportSvg, REL_LIGHT } from "../src/rel/RelSvg";
import { mapErToRelational } from "../src/rel/mapping";
import { EXAMPLES } from "../src/examples";
const OUT = process.env.OUT_DIR;
it.skipIf(!OUT)("render", () => {
  for (const ex of EXAMPLES) {
    const d = parseErDsl(ex.dsl).diagram;
    writeFileSync(`${OUT}/${ex.id}.svg`, renderToStaticMarkup(<ErExportSvg diagram={d} pal={LIGHT} />));
    writeFileSync(`${OUT}/${ex.id}-rel.svg`, renderToStaticMarkup(<RelExportSvg schema={mapErToRelational(d).schema} pal={REL_LIGHT} />));
  }
});
