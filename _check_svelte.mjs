import { compile } from 'svelte/compiler';
import { readFileSync } from 'fs';
const files = process.argv.slice(2);
let hadIssue = false;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  try {
    const { warnings } = compile(src, { filename: f, generate: false });
    for (const w of warnings) {
      console.log(`[WARN] ${f}: ${w.code} — ${w.message} (${w.start?.line}:${w.start?.column})`);
      hadIssue = true;
    }
    console.log(`OK ${f}`);
  } catch (e) {
    console.log(`[ERROR] ${f}: ${e.message}`);
    hadIssue = true;
  }
}
process.exit(hadIssue ? 1 : 0);
