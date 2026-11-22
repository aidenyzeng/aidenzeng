const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname, '..', 'src', 'nailong.js'),'utf8');
const original=fs.readFileSync(path.join(__dirname, '..', 'docs', 'blue-whale-reference.js'),'utf8');
const physics=s=>s.split('// ===== physics.js =====')[1].split('// ===== shaders.js =====')[0];
if(physics(source)!==physics(original))throw Error('Reference physics differs');
const SoftBody=new Function(physics(source)+';return SoftBody;')();
const mesh=JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'mesh', 'nailong-mesh.json'),'utf8')).simMesh;
mesh.rest=new Float32Array(mesh.rest);mesh.tets=new Uint32Array(mesh.tets);mesh.region=new Uint8Array(mesh.region);
const sim=new SoftBody(mesh,{firmness:.5,damping:.4});
for(let i=0;i<120;i++)sim.step();
const restingVolume=sim.volumeRatio();
sim.beginGrab([-.9,1.1,.5],.4);
for(let i=0;i<45;i++){const t=i/45;sim.moveGrab([-.9-.4*t,1.1+.4*t,.5+.1*t]);sim.step();}
const heldVolume=sim.volumeRatio();sim.endGrab();for(let i=0;i<120;i++)sim.step();
const report={referencePhysicsIdentical:true,nodes:sim.n,tetrahedra:sim.nT,restingVolume,heldVolume,recoveredVolume:sim.volumeRatio(),finite:Array.from(sim.x).every(Number.isFinite),minHeight:Math.min(...Array.from({length:sim.n},(_,i)=>sim.x[3*i+1]))};
report.pass=report.finite&&report.minHeight>=-1e-5&&Math.abs(report.recoveredVolume-1)<.05;
fs.writeFileSync(path.join(__dirname, '..', 'docs', 'artifact-physics-check.json'),JSON.stringify(report,null,2));console.log(report);if(!report.pass)process.exitCode=1;
