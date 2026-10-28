# Technology choices and alternatives considered

| Decision | Chosen | Alternatives | Reason |
|---|---|---|---|
| Scene representation | 3D Gaussian Splatting | NeRF (nerfacto), textured mesh | Photorealistic view-dependent appearance *and* real-time rasterisation in a browser. NeRF needs per-pixel ray marching (too slow for WebGL). Meshes lose fidelity on thin and glossy indoor objects. |
| Camera poses | COLMAP (via `ns-process-data`) | DUSt3R/MASt3R, phone ARKit/ARCore poses | COLMAP is the reference SfM (Schönberger & Frahm 2016), is scriptable, and gives SfM points that Splatfacto uses for initialisation. DUSt3R is a strong fallback for sparse or low-texture captures but is GPU-heavy for hundreds of frames and adds another dependency. We keep it as a documented fallback only. |
| Trainer | nerfstudio Splatfacto (gsplat) | Original INRIA 3DGS code, gsplat `simple_trainer` | One CLI covers data processing, training and export. Documented memory is about 6 GB (fits a free Colab T4). Apache-2.0 licence, whereas the INRIA code is non-commercial. |
| Geometry pipeline | (not used) | Meshroom / AliceVision | Produces meshes, which are useful for future collision and navigation meshes but not for photoreal rendering. Kept as a Round 2 candidate for an obstacle mesh. |
| Web renderer | Spark 2.3.1 + three.js | SuperSplat viewer, GaussianSplats3D, PlayCanvas engine | Spark integrates as a normal three.js object, so standard camera, controls and future POI/path overlays work. It loads PLY, SPZ, SOG, SPLAT and KSPLAT, and is MIT-licensed. |
| Web format | SOG (splat-transform) | Raw PLY, SPZ | Typically an order of magnitude smaller than PLY (to be measured on the real model), which is decisive for public hosting and load time. SPZ is comparable and also supported by the viewer (change `file` in the manifest). |
| Hosting | Static host (Vercel / Netlify / GitHub Pages) | Custom server | The viewer is a static site with no backend, so zero-install access by link works anywhere. |
