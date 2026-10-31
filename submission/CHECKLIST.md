# Round 1 release checklist (31 Oct 2026)

Current submission: **room2 full-frame, 60,000-step reconstruction**.

| Deliverable | Status | Evidence / location |
|---|---|---|
| Capture and quality gate | Verified | 15:01-minute 4K video; 1,486 quality-filtered images |
| Local GPU COLMAP | Verified | 1,474 registered cameras (99.2%); 326,511 points; 0.653 px mean reprojection error |
| Full-frame training | Verified | All 1,474 cameras, 1600x900, 60,000 steps; RTX 5060 / WSL2 |
| Final export | Verified | 1,296,805 exported Gaussians; 0 NaN/Inf; 30,843,929-byte SPZ |
| Viewer and calibration | Verified locally | Versioned model, 17-vertex walk outline, three remapped saved views; metric scale remains approximate |
| Tests and production build | Passed | 23 JavaScript and 7 Python tests; Vite build; composed-transform regression coverage |
| Technical abstract | Ready | 5 pages; new screenshots, full-run metrics and team ID |
| Additional links PDF | Ready | Viewer, repository, full-run details and Drive folder |
| GitHub / production | Verified | main pushed; GitHub CI passed; https://stardust-ns.vercel.app/ loads the full model. Downloaded production SPZ SHA-256 matches the local export. |
| Drive PDFs | Updated | Both PDFs replaced in place; existing file IDs preserved; abstract text checked after upload |
| Source and browser-ready model archives | Uploaded | 03_Source_Code.zip and 04_Model_and_Run_Outputs.zip in the submission folder |
| Full PLY and run evidence | Uploaded | 05_Full_PLY_Archive contains the complete output ZIP in four parts below the connector's 100 MB limit, plus reassembly instructions and SHA-256 checksums |
| Demo video (3-5 min) | Pending | Record the new model; storyboard: submission/demo_storyboard.md |
| Sample data | Present | Synthetic fixture in test/sample_data/; private full capture is excluded |
| Cold-load / sustained FPS benchmark | Pending | No measured performance claim for the full room2 release |

Drive folder: https://drive.google.com/drive/folders/17erIqZJBRfdBJkza_zMT-XNjzyQLLuHW

Exact current run values and SPZ SHA-256: submission/room2_full_run.json.
Earlier runs remain as history in submission/metrics.md.

Full archive folder: https://drive.google.com/drive/folders/1DJI7kAri_KElwjHmb1VCxBOpfjznEK-H
