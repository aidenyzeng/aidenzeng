# Nailong Jelly — artifact engine port

The app now uses the physics engine and UI from the user-provided Blue Whale Jelly artifact:
https://claude.ai/artifact/CGa66nQyfdNP5mNYVySRii

`nailong.js` retains the reference's physics section unchanged: co-rotational tetrahedral XPBD, signed-volume constraints, internal edge damping, friction, floor contact, soft grabs and twisting. The custom multi-pass renderer and specimen-panel stylesheet are retained. Nailong's SDF, face, belly, tongue, palette, framing and explanatory copy are adapted for the supplied character image. Jiggle replaces the whale's gulp action; Drops retains the reference's loose jelly beads.

The same solver does not imply an identical mesh: Nailong uses its own snapped tetrahedral mesh at 0.24-unit spacing. Display pixel ratio is capped at 1.5 for this larger specimen. Physics and rendering algorithms are the reference's, while character geometry is purpose-built.

## Edit and run

Serve the repository root with Python 3:

```sh
python3 -m http.server 8791
```

Then open http://127.0.0.1:8791/. Three.js loads from jsDelivr, so the browser needs an internet connection. Node.js is needed only for mesh regeneration and checks.

After editing geometry in `nailong.js`, regenerate the cached mesh and barycentric embedding:

```sh
node build-mesh.cjs
```

Then reload the page. Cache generation avoids rerunning the costly procedural meshing and embedding on each reload.

## Checks

```sh
node --check nailong.js
node check-mesh.cjs
node check-physics.cjs
```

The physics check verifies exact reference-source equality, settles the current mesh, stretches a head patch, releases it, and checks finite positions, floor contact and recovered volume. Its current result is saved in `review/artifact-physics-check.json`.

Latest result: 852 nodes, 2,705 tetrahedra; volume 99.24% at rest, 100.19% held, 99.52% after release; finite positions and no floor penetration. Native browser Jiggle, head dragging and Reset were also inspected; no console errors were captured. Current visual evidence is `review/artifact-engine-nailong.png`.

The anatomy is a procedural reconstruction of one reference image and should not be described as pixel-identical. The original artifact source is preserved in `review/blue-whale-reference.js` for source-equivalence verification.

Mesh generation also checks that the body has no open boundary edges, preventing clipped head caps when the character grows beyond old extraction bounds.

Surface rendering now uses a denser skin mesh, a displacement filter and three normal-smoothing passes. Eyes and nails use coherent attachment frames and render separately from the refracted interior, preventing duplicate images and distorted details. Nail placement searches the complete body depth; mesh checks verify that nail roots lie on the skin and their rest geometry clears the floor. The reference physics section remains unchanged.

### Mouth, tongue and hand detail refinement

The render surface now uses a 0.024 grid and supports device pixel ratios up to 2. The cavity has a narrow antialiased lip transition, and the purple tongue mask follows the same smooth-union field as its flatter, broader geometry. The tongue clears the arm; the former head claws are rooted at the hanging hand tip. Cached assets have a revision query so existing browser sessions pick up the changes.

Verified: closed mesh (88,268 body triangles), all claw roots on limbs, exact reference solver retained, stable grab/release and floor contact (99.49% recovered volume), no browser errors. Screenshot: `review/mouth-tongue-hand-fix.png`.
