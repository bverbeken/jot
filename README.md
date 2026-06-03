# Jot

Handwrite annotations on PDFs in Obsidian with your Apple Pencil. Strokes are stored in a tiny JSON sidecar (`<file>.ink.json`) next to the original file — the original PDF is never modified — so annotations sync via Git or iCloud alongside the rest of your vault.

Status: **early, working**. PDFs only for now. Future targets: images and standalone handwritten notes.

## Development

```bash
npm install
npm run dev     # watch build into dev-vault/.obsidian/plugins/jot/
npm run build   # production build at the repo root (for release uploads)
```

Open `dev-vault/` as a vault in Obsidian to test. The dev vault is gitignored and is not your real notes vault.

### Testing on iPad

1. Cut a GitHub release (`npm version patch` then `git push origin <tag>` — the release workflow uploads `main.js`, `manifest.json`, `styles.css`).
2. On the iPad, install the **BRAT** plugin into a *separate dev vault* — never your real one.
3. In BRAT, add this repo as a beta plugin. BRAT pulls the release and installs it.

## API documentation

https://docs.obsidian.md
