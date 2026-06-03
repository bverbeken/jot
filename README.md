# Obsidian Ink

Handwrite PDF annotations in Obsidian with Apple Pencil. Strokes are saved as standard PDF ink annotations inside the file itself — so they sync via Git / Working Copy alongside the rest of the vault.

Status: **early scaffolding**. Not yet functional.

## Development

```bash
npm install
npm run dev     # watch build into dev-vault/.obsidian/plugins/obsidian-ink/
npm run build   # production build at the repo root (for release uploads)
```

Open `dev-vault/` as a vault in Obsidian to test (Open vault → Open folder as vault). The dev vault is gitignored and is not your real notes vault.

### Testing on iPad

1. Cut a GitHub release (`npm version patch` then push the tag — the release workflow uploads `main.js`, `manifest.json`, `styles.css`).
2. On the iPad, install the **BRAT** plugin into a *separate dev vault* — never your real one.
3. In BRAT, add this repo as a beta plugin. BRAT pulls the release and installs it.

## API documentation

https://docs.obsidian.md
