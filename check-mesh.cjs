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
  return { openEdges, triangles: body.count / 3 };
}
module.exports = checkMesh;
if (require.main === module) {
  console.log(checkMesh(JSON.parse(fs.readFileSync(path.join(__dirname, 'nailong-mesh.json'), 'utf8'))));
}
