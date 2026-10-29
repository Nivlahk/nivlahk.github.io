// Compiles schema.dbml with @icebolt/compiler-core into src/db/.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { compileSchema, generateClientSource, formatDiagnostic } from '@icebolt/compiler-core';

const result = compileSchema(readFileSync(new URL('./schema.dbml', import.meta.url), 'utf8'));
for (const d of result.diagnostics) console.warn('icebolt:', formatDiagnostic(d));
const out = new URL('./src/db/', import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL('icebolt-client.ts', out), generateClientSource(result));
writeFileSync(new URL('ui-manifest.json', out), JSON.stringify(result.uiManifest, null, 2) + '\n');
writeFileSync(new URL('migration.sql', out), result.sqlMigration);
console.log(`icebolt: compiled ${result.schema.tables.length} tables, schema ${result.schemaHash}`);
