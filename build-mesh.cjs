// Regenerate after editing Nailong's SDF or render geometry in nailong.js.
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'nailong.js'), 'utf8');
const geometry = source.slice(0, source.indexOf('// ===== physics.js =====')).replace("import * as THREE from 'three';", '');
const build = new Function(geometry + '\nconst simMesh=buildSimMesh(.24),renderMesh=buildRenderMesh();return {simMesh,renderMesh,emb:embed(simMesh.rest,simMesh.tets,renderMesh.rest,[renderMesh.krillV0,renderMesh.rest.length/3-renderMesh.krillV0])};');
const mesh = build();
fs.writeFileSync(path.join(__dirname, 'nailong-mesh.json'), JSON.stringify(mesh, (_, v) => ArrayBuffer.isView(v) ? Array.from(v) : v));
console.log(JSON.stringify({nodes:mesh.simMesh.rest.length/3,tetrahedra:mesh.simMesh.tets.length/4,vertices:mesh.renderMesh.rest.length/3}));
