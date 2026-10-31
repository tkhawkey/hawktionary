# Hawktionary

A personal dictionary, thesaurus and cryptic crossword helper. An installable web app that works offline once loaded.

## Run it locally

```
python tools/serve.py
```

Then open http://localhost:5173. This server turns caching off so edits show on reload. The service worker is skipped on localhost; add `?sw` to the address to test offline mode locally.

## Restyling

All colours, fonts, spacing and animation timings are in `public/css/tokens.css`.

## Deploying

Pushing to `main` runs `.github/workflows/pages.yml`, which publishes `public/` to GitHub Pages.
In the repository settings, set **Pages → Source** to **GitHub Actions** once.

When you change the app code, bump `SHELL_VERSION` in `public/sw.js` so installed copies pick up the new files.
When the data is regenerated, `public/data/manifest.json`'s `version` changes and old data caches are cleared automatically.

## Licences

See the About screen and `LICENSES/`. The dictionary data is shared under CC BY-SA.
