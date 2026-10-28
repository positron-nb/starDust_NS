# References and third-party acknowledgements

## Papers

1. B. Kerbl, G. Kopanas, T. Leimkühler, G. Drettakis. **3D Gaussian Splatting for Real-Time Radiance Field Rendering.** *ACM Transactions on Graphics (SIGGRAPH)* 42(4), 2023. <https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/>. This is the scene representation used for the model.
2. J. L. Schönberger, J.-M. Frahm. **Structure-from-Motion Revisited.** *CVPR* 2016. This is the incremental SfM algorithm in COLMAP, which we use for camera poses and the initial sparse points.
3. C. Ruan, Y. Wang, T. Guan, B. Zhang, L. Ju. **IndoorGS: Geometric Cues Guided Gaussian Splatting for Indoor Scene Reconstruction.** *CVPR* 2025. <https://cvpr.thecvf.com/virtual/2025/poster/33248>. It motivates our capture rules for textureless walls and the future use of line and plane priors (roadmap).
4. S. Wang, V. Leroy, Y. Cabon, B. Chidlovskii, J. Revaud. **DUSt3R: Geometric 3D Vision Made Easy.** *CVPR* 2024. We evaluated it as a pose-free alternative to COLMAP for sparse or low-texture captures (see `docs/alternatives.md`).
5. V. Ye, R. Li, J. Kerr, M. Turkulainen, B. Yi, Z. Pan, O. Seiskari, J. Ye, J. Hu, M. Tancik, A. Kanazawa. **gsplat: An Open-Source Library for Gaussian Splatting.** *JMLR* 26, 2025. This is the rasteriser behind Splatfacto.
6. M. Tancik et al. **Nerfstudio: A Modular Framework for Neural Radiance Field Development.** *SIGGRAPH Conference Proceedings* 2023.

## Software

| Tool | Version used | Role | Licence | Source |
|---|---|---|---|---|
| COLMAP | Ubuntu apt build (Colab) / 3.x release (Windows) | SfM camera poses | BSD-3-Clause | <https://github.com/colmap/colmap> |
| nerfstudio | 1.1.5 | `ns-process-data`, `ns-train splatfacto`, `ns-export` | Apache-2.0 | <https://github.com/nerfstudio-project/nerfstudio> |
| gsplat | 1.4.0 (pinned by nerfstudio) | CUDA Gaussian rasterisation | Apache-2.0 | <https://github.com/nerfstudio-project/gsplat> |
| Spark | 2.3.1 | WebGL2 Gaussian-splat renderer for three.js | MIT | <https://github.com/sparkjsdev/spark> |
| three.js | 0.186.1 | 3D engine, camera, render loop | MIT | <https://threejs.org> |
| splat-transform | 3.10.1 | PLY to SOG compression, NaN filtering | MIT | <https://github.com/playcanvas/splat-transform> |
| SuperSplat | web app (optional) | Manual inspection and cleanup of floaters | MIT | <https://github.com/playcanvas/supersplat> |
| Vite | 8.3.4 | Dev server and static build | MIT | <https://vitejs.dev> |
| imageio-ffmpeg | 0.6.0 (bundles FFmpeg 7.1) | Frame decoding | BSD-2-Clause wrapper; FFmpeg binary LGPL/GPL | <https://github.com/imageio/imageio-ffmpeg> |
| NumPy, Pillow | 2.5.3, 12.3.0 | Image metrics | BSD-3 / MIT-CMU | |
| Inter, JetBrains Mono | Google Fonts | UI typography | SIL OFL 1.1 | <https://fonts.google.com> |
| Meshroom (AliceVision) | not used | Considered as a mesh-based alternative pipeline | MPL-2.0 | <https://github.com/alicevision/meshroom> |

All dependencies are used under their licences. No third-party code is copied into this repository; dependencies are installed from npm and PyPI.
