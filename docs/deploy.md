# Putting Lightspeed FX online

The app is a static site: everything is in `dist/` after a build. **Always build without a model key.** Vite writes
`VITE_` variables into the page, so a build made with `VITE_LLM_KEY` set gives the key to anyone who opens it.
`npm run package` builds with the key variables emptied, checks the built files for any key configured on this
machine, and writes `lightspeed-fx-demo.zip` (the contents of `dist/`). None of the three routes below has been tried
by us yet.

**The repository.** A remote (`origin`) is configured, but nothing has been pushed to it. To publish `main` and the
tags:

```
git push -u origin main
git push origin --tags
```

## 1. A static host, by drag and drop

1. Run `npm run package` and unzip `lightspeed-fx-demo.zip` into a new folder.
2. Open the host's drag-and-drop deploy page (Netlify Drop is one) and drop that folder on it.
3. Open the address it gives you, and add `?demo` for the guided demo.

## 2. A static host, from the repository

1. Push `main` (above), then create a site on the host from the repository.
2. Build command `npm run build`; publish directory `dist`; Node 20 or newer.
3. Do **not** add `VITE_LLM_KEY` to the host's environment variables.
4. Every push to `main` then rebuilds the site.

## 3. GitHub Pages

1. Push `main` (above), then run `npm run build` with no key set.
2. Publish `dist/` to a `gh-pages` branch: `npx gh-pages -d dist` (fetches a small publishing tool).
3. On GitHub: Settings, Pages, Source "Deploy from a branch", branch `gh-pages`, folder `/`.
4. The app uses relative paths (`base: './'`), so it works at `https://<user>.github.io/LightFx/`.
