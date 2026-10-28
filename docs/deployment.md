# Deployment

The viewer is a static site: `npm run build` produces `dist/` (HTML, about 3 MB of JS including Spark's WASM, CSS, and `models/`). The build uses relative asset paths (`base: "./"`), so it works at a domain root or in a sub-path such as GitHub Pages `/<repo>/`.

## Vercel (recommended)

```powershell
npm run build
npx vercel@latest deploy dist --prod      # first run asks you to log in and name the project
```

Or connect the GitHub repo in the Vercel dashboard with framework *Vite*, build `npm run build` and output `dist`. `vercel.json` sets long-lived caching for the model and JS bundles and a `no-cache` header for `manifest.json`, so recalibration is visible immediately.

## Netlify

`netlify.toml` contains the same build settings. Run `npx netlify-cli deploy --dir dist --prod`.

## GitHub Pages

Push `dist/` to a `gh-pages` branch, or use a Pages workflow with `npm ci && npm run build` and upload `dist`. Per-file limit is 100 MB, so models above 50 MB should be hosted elsewhere (see the README size table).

## Post-deploy verification (record results in `submission/metrics.md`)

1. Open the URL in a **fresh incognito window** (no cache, not logged in).
2. Confirm the progress bar reaches 100 % and the HUD shows the splat count. Note the **Load** time.
3. Open DevTools → Console. There should be no errors. Spark emits a harmless D3D shader warning `X3203` on Windows/ANGLE.
4. Open DevTools → Network. `models/*.sog` should return 200 with the expected size, and `manifest.json` should return 200.
5. Click Start, then check `W A S D`, mouse-look, `Shift`, `Q`/`E`, `R` reset, `Esc` release and resume, the exit button, and resizing the window.
6. Leave it running for 60 s and note the FPS range from the HUD.
7. Test on a second browser (Chrome plus Firefox or Edge).
