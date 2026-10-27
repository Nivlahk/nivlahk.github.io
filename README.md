# calvinhancock.com

Portfolio site for Calvin W. Hancock, served by GitHub Pages at [calvinhancock.com](https://calvinhancock.com).

## Layout

| Path | What it is | Live URL |
|---|---|---|
| `index.html` | Portfolio home page | `/` |
| `resume.pdf` | Resume, linked from the home page | `/resume.pdf` |
| `SPOKEN/` | Voice coding in the browser with Vertex, an English-like language | `/SPOKEN/` |
| `SPOKEN/about/` | How SPOKEN works | `/SPOKEN/about/` |
| `NEFS/` | Featural script designer for the IPA | `/NEFS/` |
| `NEFS/about/` | How NEFS works | `/NEFS/about/` |
| `SYNTAX/` | Syntax Tree Sandbox: drag-and-drop constituency parsing | `/SYNTAX/` |
| `SYNTAX/about/` | How the sandbox works | `/SYNTAX/about/` |
| `SEER/` | SEER assembly editor (not linked from the home page yet) | `/SEER/` |
| `assets/` | Share images (`og-*.png`) and the about-page stylesheet (`about.css`) | — |
| `sitemap.xml`, `robots.txt`, `llms.txt` | Crawler files | — |
| `CNAME` | Custom domain for GitHub Pages | — |

Every page is static HTML with no build step. To add a project, create a folder with its own `index.html`, an `about/index.html` that uses `/assets/about.css`, and a `README.md`; then add a card to the `#projects` section of the root `index.html` and both URLs to `sitemap.xml`.
