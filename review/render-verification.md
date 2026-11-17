# Shadow and arm rendering verification

The floor contact shadow uses the body's lowest-surface height map with a compact 12-sample kernel. Warm-grey tint strength is 10%, independent of the jelly palette; shadow opacity is capped at 0.35. The key direction is near overhead. Removed the floor's jelly transmission and oblique cast-shadow sampling.

The arm was already in the SDF union rather than a separate mesh. The render-only union is now broader and embedded farther into the torso to remove the hard crease. The jelly material explicitly uses transparent:false, depthWrite:true and depthTest:true; translucency remains shader-based. Render surface is closed and has one connected component (88,052 body triangles).

Physics solver text and every value of the cached simulation mesh are identical to parent commit 4e30837. UI HTML and CSS are identical except the script cache revision. `node build-mesh.cjs --render-only` preserves the existing simulation mesh while updating the render mesh and embedding. Syntax, topology, arm grab/release/reset, and browser error checks passed.

## Performance

IAB browser, 1280×720 drawing buffer, default camera/palette/firmness/damping, running physics with 10 substeps. Each test discards 120 warm-up frames and measures the next 240. Tests ran sequentially, with the previous test tab closed. Frame interval measures RAF delivery; CPU duration measures the frame callback through rendering submission, not isolated GPU time. Opt-in `?profile` writes the result to the canvas data-profile attribute without UI controls.

| Metric (ms) | Warm baseline | Final |
|---|---:|---:|
| Median frame interval | 50.0 | 50.0 |
| P95 frame interval | 66.7 | 66.6 |
| Median CPU frame work | 51.9 | 50.9 |
| P95 CPU frame work | 53.5 | 52.8 |

No regression in the paired warm comparison. An initial cold baseline measured 46.0 ms CPU median; browser/system load varied during iteration, so this is not a universal performance guarantee. All retained raw measurements are in render-before-timing.json, render-before-warm-timing.json, and render-after-timing.json.

Matching screenshots: shadow-arm-before.png and shadow-arm-after.png.
