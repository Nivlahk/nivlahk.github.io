# SYNTAX tree library

Saves Syntax Tree Sandbox benches to each player's **own Google Drive**, built on
[`@icebolt/compiler-core`](../../../icebolt). This site never receives anyone's trees.
Scores are not stored: SYNTAX points still last for one visit.

| File | Role |
|---|---|
| `schema.dbml` | Database design: `trees` (saved benches) and `phrases` (every finished phrase, for analysis) |
| `compile.mjs` | Runs the Icebolt compiler → `src/db/` (typed client, UI manifest, migration SQL) |
| `src/main.ts` | The library panel: connect, save, open, star, delete, storage settings |
| `../../SYNTAX/library.js` | Built bundle the page loads (commit it; GitHub Pages has no build step) |
| `../../SYNTAX/vendor/` | sql.js 1.15.2 (SQLite compiled to WebAssembly), fetched only after connecting |

## Rebuild after changing the schema or panel (WSL)

```bash
cd ~/nivlahk.github.io/tools/syntax-library
npm install
npm run build
```

`npm install` expects the Icebolt package at `~/icebolt`, built with `npm run build`.

## Switch on Drive saving

1. In Google Cloud Console: create a project, enable the **Google Drive API**, set up the
   **OAuth consent screen** with the `.../auth/drive.file` scope, then create an
   **OAuth client ID → Web application** with these Authorized JavaScript origins:
   `https://calvinhancock.com` and `http://localhost:8000`.
2. Paste the client ID into `SYNTAX/index.html`:
   `<section class="dock lib" … data-google-client-id="PASTE-HERE.apps.googleusercontent.com">`

No client secret, server, or rebuild is needed. While the consent screen is in *Testing*,
only the test users you list can connect.

## Analyze your own trees

Turn on **Storage settings → Readable copies** and the panel keeps `phrases.ndjson` and
`trees.ndjson` (plus BigQuery schema files) in a Drive folder. For example, which phrase
shapes you build most:

```sql
SELECT category, bracketing, COUNT(*) AS times
FROM mydataset.phrases
GROUP BY category, bracketing
ORDER BY times DESC
LIMIT 20;
```
