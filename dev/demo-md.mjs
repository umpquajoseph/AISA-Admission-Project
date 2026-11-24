/* Rewrites the Steps table in docs/DEMO.md from site/demo-steps.js, the one source
 * the in-app walkthrough also reads.   node dev/demo-md.mjs */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const win = {};
new Function("window", readFileSync(path.join(ROOT, "site", "demo-steps.js"), "utf8"))(win);
const md = path.join(ROOT, "docs", "DEMO.md"), text = readFileSync(md, "utf8"), nl = text.includes("\r\n") ? "\r\n" : "\n";
const lines = text.split(/\r?\n/), at = lines.indexOf("| # | Click | Say |");
if (at < 0) throw new Error("DEMO.md has no '| # | Click | Say |' table");
let end = at + 2; while (end < lines.length && lines[end].startsWith("|")) end++;
const rows = win.DEMO_STEPS.map((s, i) => `| ${i + 1} | ${s.click} | "${s.say}" |`);
lines.splice(at + 2, end - at - 2, ...rows);
writeFileSync(md, lines.join(nl));
console.log(`DEMO.md: ${rows.length} steps written`);
