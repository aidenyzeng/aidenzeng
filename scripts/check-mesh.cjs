const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
function checkMesh(mesh) {
  const { rest, index, body } = mesh.renderMesh;
  const edges = new Map();
  for (let i = body.first; i < body.first + body.count; i += 3) {
    const [a, b, c] = index.slice(i, i + 3);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      edges.set(key, (edges.get(key) || 0) + 1);
    }
  }
  const openEdges = [...edges.values()].filter(n => n === 1).length;
  assert.equal(openEdges, 0, `Body has ${openEdges} open edges: expand the extraction bounds or repair the surface.`);
  assert(rest.every(Number.isFinite), 'Mesh contains non-finite positions');
  for (const detail of mesh.renderMesh.surfaceDetails || []) {
    assert(detail.v0 >= 0 && detail.v0 + detail.nv <= rest.length / 3, 'Invalid detail attachment range');
    assert(detail.anchor.length === 3 && detail.anchor.every(Number.isFinite), 'Invalid detail anchor');
    if (mesh.renderMesh.mat[detail.v0] === 5) {
      assert(detail.anchor[0] > 0, 'Claw attached to the head instead of a hand or foot');
      assert(Math.abs(detail.surfaceDistance) < .002, 'Claw root does not sit on the body surface');
      for (let v = detail.v0; v < detail.v0 + detail.nv; v++) assert(rest[v * 3 + 1] >= .03, 'Claw intersects the floor in its rest pose');
    }
  }
  return { openEdges, triangles: body.count / 3, attachedDetails: (mesh.renderMesh.surfaceDetails || []).length };
}
module.exports = checkMesh;
if (require.main === module) {
  console.log(checkMesh(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'mesh', 'nailong-mesh.json'), 'utf8'))));
}
