import { digitsIn, parseBatch, validate, inputOf } from "../lib.ts";

function eq(a: unknown, b: unknown, msg: string) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`); }

const input = inputOf({ id: 1, title: "Scientists find 3 new species in 2026", summary: "The team said the frogs are tiny.", source_name: "x" });

Deno.test("accepts a faithful Arabic translation", () => {
  eq(validate(input, { title: "علماء يكتشفون 3 أنواع جديدة في 2026", summary: "قال الفريق إن الضفادع صغيرة جداً." })?.title, "علماء يكتشفون 3 أنواع جديدة في 2026", "title");
});
Deno.test("rejects invented numbers", () => { eq(validate(input, { title: "علماء يكتشفون 7 أنواع جديدة", summary: "" }), null, "number"); });
Deno.test("rejects non-Arabic output", () => { eq(validate(input, { title: "Scientists find new species", summary: "" }), null, "latin"); });
Deno.test("rejects invented quotations", () => { eq(validate(input, { title: "علماء يكتشفون أنواعاً جديدة", summary: "قال الفريق: «مذهل»." }), null, "quote"); });
Deno.test("Arabic-Indic digits count as the same numbers", () => { eq([...digitsIn("٣ أنواع عام ٢٠٢٦")].sort(), ["2026", "3"], "digits"); });
Deno.test("parses wrapped and bare batches, ignores junk", () => {
  eq(parseBatch('نص {"items":[{"i":1,"title":"أ"}]} نص').length, 1, "wrapped");
  eq(parseBatch('[{"i":1,"title":"أ"},{"i":2,"title":"ب"}]').length, 2, "bare");
  eq(parseBatch("no json"), [], "junk");
});
