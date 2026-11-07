// Builds assets/world-map.json: one SVG path per country (ISO 3166-1 alpha-2), projected once at build time so the
// site needs no map library. Source: Natural Earth 1:110m via the world-atlas package (public domain).
// Usage (from a folder with the dev packages installed):
//   npm i world-atlas@2 topojson-client@3 d3-geo@3 i18n-iso-countries@7
//   node scripts/gen-world-map.mjs > assets/world-map.json
import fs from "node:fs";
import { createRequire } from "node:module";
import { feature } from "topojson-client";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import countries from "i18n-iso-countries";

const require = createRequire(import.meta.url);
const topo = JSON.parse(fs.readFileSync(require.resolve("world-atlas/countries-110m.json"), "utf8"));
const W = 960, H = 500;
const geo = feature(topo, topo.objects.countries);
geo.features = geo.features.filter((f) => f.properties.name !== "Antarctica");
const proj = geoNaturalEarth1().fitExtent([[4, 4], [W - 4, H - 4]], geo);
const path = geoPath(proj).digits(1);
const out = {};
const special = { Kosovo: "XK", "N. Cyprus": null, Somaliland: null };
for (const f of geo.features) {
  const name = f.properties.name;
  const iso = name in special ? special[name] : countries.numericToAlpha2(String(f.id).padStart(3, "0"));
  if (!iso) continue;
  const d = path(f);
  if (!d) continue;
  out[iso] = out[iso] ? out[iso] + d : d;
}
process.stdout.write(JSON.stringify({ w: W, h: H, source: "Natural Earth 1:110m (world-atlas), public domain", countries: out }));
