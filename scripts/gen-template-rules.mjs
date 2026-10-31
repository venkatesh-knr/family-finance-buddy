/**
 * Regenerates src/domain/export/rules.generated.ts from the migrations.
 *
 * Run: node scripts/gen-template-rules.mjs          (writes the file)
 *      node scripts/gen-template-rules.mjs --stdout (prints it; what the test compares against)
 */

import { writeFileSync } from 'node:fs';
import { renderModule, templateRules } from './lib/schema-rules.mjs';

const text = renderModule(templateRules());

if (process.argv.includes('--stdout')) {
  process.stdout.write(text);
} else {
  writeFileSync('src/domain/export/rules.generated.ts', text, 'utf8');
  console.log('wrote src/domain/export/rules.generated.ts');
}
