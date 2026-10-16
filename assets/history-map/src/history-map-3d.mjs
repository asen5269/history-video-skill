import {validateStory3D,cameraAt3D,terrainPoint3D} from './story-3d.mjs';
export async function createHistoryMap3D(canvas,story,{THREE:T,baseUrl,width=1920,height=1080}){
 const url=x=>new URL(x,new URL(baseUrl,location.href)).href;
 const [d,land,rivers]=await Promise.all([story.terrain,story.land,story.rivers].map(x=>fetch(url(x)).then(r=>r.json())));
 validateStory3D(story,d);
 const worldWidth=story.worldWidth??160,exaggeration=story.verticalExaggeration??1;
 const [l,t,r,b]=d.extent,scale=worldWidth/(r-l),depth=(b-t)*scale;
 const merc=([lon,lat])=>[(lon+180)/360,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2];
 const point=c=>new T.Vector3(...terrainPoint3D(d,c,worldWidth,exaggeration));
 const tex=document.createElement('canvas');tex.width=3072;tex.height=2560;const ctx=tex.getContext('2d');
 ctx.fillStyle=story.style?.sea??'#082b3c';ctx.fillRect(0,0,tex.width,tex.height);
 const xy=(c)=>{const [u,v]=merc(c);return [(u-l)/(r-l)*tex.width,(v-t)/(b-t)*tex.height];};
 const ring=coords=>{coords.forEach((c,i)=>{const [x,y]=xy(c);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.closePath();};
 ctx.fillStyle=story.style?.land??'#526453';ctx.strokeStyle='#8c9871';ctx.lineWidth=1.4;
 for(const f of land.features){const polys=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;for(const p of polys){ctx.beginPath();p.forEach(ring);ctx.fill('evenodd');ctx.stroke();}}
 ctx.strokeStyle=story.style?.river??'#5d9daf';ctx.lineWidth=1.7;
 for(const f of rivers.features){if((f.properties.rank??1)>3)continue;const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates;for(const line of lines){ctx.beginPath();line.forEach((c,i)=>{const [x,y]=xy(c);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});ctx.stroke();}}
 const texture=new T.CanvasTexture(tex);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;
 const geo=new T.BufferGeometry(),pos=[],uv=[],indices=[];
 for(let j=0;j<d.height;j++)for(let i=0;i<d.width;i++){pos.push((i/(d.width-1)-.5)*worldWidth,d.elevations[j*d.width+i]/40075016.7*scale*exaggeration,(j/(d.height-1)-.5)*depth);uv.push(i/(d.width-1),1-j/(d.height-1));}
 for(let j=0;j<d.height-1;j++)for(let i=0;i<d.width-1;i++){const a=j*d.width+i;indices.push(a,a+d.width,a+1,a+1,a+d.width,a+d.width+1);}
 geo.setAttribute('position',new T.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uv,2));geo.setIndex(indices);geo.computeVertexNormals();
 const scene=new T.Scene();scene.background=new T.Color('#081318');scene.fog=new T.Fog('#081318',160,280);
 scene.add(new T.Mesh(geo,new T.MeshStandardMaterial({map:texture,roughness:.94,metalness:.06,side:T.DoubleSide})));
 scene.add(new T.HemisphereLight('#dae9e3','#121c1b',2.1));const sun=new T.DirectionalLight('#ffdab0',3.1);sun.position.set(-70,60,-80);scene.add(sun);
 const water=new T.Mesh(new T.PlaneGeometry(800,800),new T.MeshStandardMaterial({color:'#071c28',roughness:.85,metalness:.2}));water.rotation.x=-Math.PI/2;water.position.y=-.08;scene.add(water);
 const spots=(story.places??[]).map(p=>point(p.coordinates));
 const markers=[];
 for(const p of spots){const group=new T.Group();scene.add(group);markers.push(group);const dot=new T.Mesh(new T.SphereGeometry(.58,20,16),new T.MeshBasicMaterial({color:'#ffe3a1'}));dot.position.copy(p);dot.position.y+=.4;group.add(dot);const pole=new T.Mesh(new T.CylinderGeometry(.09,.09,6,8),new T.MeshBasicMaterial({color:'#d4b371'}));pole.position.copy(p);pole.position.y+=3;group.add(pole);const ringMesh=new T.Mesh(new T.RingGeometry(.9,1.18,48),new T.MeshBasicMaterial({color:'#bf975a',side:T.DoubleSide}));ringMesh.rotation.x=-Math.PI/2;ringMesh.position.copy(p);group.add(ringMesh);}
 const camera=new T.PerspectiveCamera(42,width/height,.1,1000);
 const renderer=new T.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});renderer.setSize(width,height);renderer.setPixelRatio(1);renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;
 const routes=(story.routes??[]).map(route=>{const points=route.coordinates.map(c=>{const p=point(c);p.y+=.3;return p;});const geometry=new T.BufferGeometry().setFromPoints(points);const line=new T.Line(geometry,new T.LineBasicMaterial({color:route.color??'#d1ae6c'}));scene.add(line);return {route,line,geometry,count:points.length};});
 const regionObjects=(story.regions??[]).map(region=>{const group=new T.Group();const polys=region.geometry.type==='Polygon'?[region.geometry.coordinates]:region.geometry.coordinates;for(const poly of polys)for(const ring of poly){const g=new T.BufferGeometry().setFromPoints(ring.map(c=>{const p=point(c);p.y+=.25;return p;}));group.add(new T.Line(g,new T.LineBasicMaterial({color:region.color??'#b49169'})));}scene.add(group);return {region,group};});
 const active=(item,time)=>time>=(item.start??0)&&time<(item.end??Infinity);
 const setTime=time=>{const k=cameraAt3D(story.camera,time);camera.position.set(...k.position);camera.lookAt(...k.target);camera.updateMatrixWorld();markers.forEach((g,i)=>g.visible=active(story.places[i],time));routes.forEach(({route,line,geometry,count})=>{line.visible=active(route,time);const progress=route.duration?Math.max(0,Math.min(1,(time-(route.start??0))/route.duration)):1;geometry.setDrawRange(0,Math.max(2,Math.ceil(count*progress)));});regionObjects.forEach(({region,group})=>group.visible=active(region,time));renderer.render(scene,camera);return spots.map((p,i)=>{const v=p.clone();v.y+=6;v.project(camera);return {...story.places[i],visible:markers[i].visible&&v.z>=-1&&v.z<=1,x:(v.x+1)*width/2,y:(1-v.y)*height/2};});};
 return {setTime,setFrame:(frame,fps)=>setTime(frame/fps),dispose(){scene.traverse(o=>{o.geometry?.dispose();if(o.material){const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>m.dispose());}});texture.dispose();renderer.dispose();}};
}
