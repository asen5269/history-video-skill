export const mercator3D = ([lon,lat]) => [(lon+180)/360,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2];
export function validateStory3D(s,d){
 if(!(s.duration>0)||!s.camera?.length)throw Error('duration与camera必填');
 if(d.width<2||d.height<2||d.elevations?.length!==d.width*d.height||!d.elevations.every(Number.isFinite))throw Error('高程网格无效');
 const [l,t,r,b]=d.extent;if(![l,t,r,b].every(Number.isFinite)||l>=r||t>=b)throw Error('地形extent无效');
 const coordinate=c=>{if(!Array.isArray(c)||c.length<2||!Number.isFinite(c[0])||!Number.isFinite(c[1])||Math.abs(c[0])>180||Math.abs(c[1])>=85.051129)throw Error('无效经纬度');const [u,v]=mercator3D(c);if(u<l||u>r||v<t||v>b)throw Error('坐标超出地形覆盖，需准备对应区域DEM');};
 const ids=new Set();for(const p of s.places??[]){if(!p.id||ids.has(p.id))throw Error('地点ID缺失或重复');ids.add(p.id);coordinate(p.coordinates);}
 for(const route of s.routes??[]){if(!route.coordinates||route.coordinates.length<2||!route.meaning)throw Error('路线需要坐标及含义');route.coordinates.forEach(coordinate);}
 for(const region of s.regions??[]){if(!region.geometry||!region.source||region.year===undefined)throw Error('历史区域需要几何、有效年代与来源');if(!['Polygon','MultiPolygon'].includes(region.geometry.type))throw Error('区域几何仅支持Polygon/MultiPolygon');const polys=region.geometry.type==='Polygon'?[region.geometry.coordinates]:region.geometry.coordinates;for(const poly of polys)for(const ring of poly){if(ring.length<4)throw Error('区域环无效');ring.forEach(coordinate);}}
 s.camera.forEach((k,i)=>{if(!Number.isFinite(k.time)||i&&k.time<=s.camera[i-1].time||![...k.position,...k.target].every(Number.isFinite))throw Error('镜头关键帧无效');});
}
export function cameraAt3D(keys,time){const right=keys.findIndex(k=>k.time>time);if(right===0)return keys[0];if(right<0)return keys.at(-1);const a=keys[right-1],b=keys[right],q=(time-a.time)/(b.time-a.time),mix=(x,y)=>x.map((v,i)=>v+(y[i]-v)*q);return {position:mix(a.position,b.position),target:mix(a.target,b.target)};}
export function terrainPoint3D(d,c,worldWidth=160,exaggeration=1){const [l,t,r,b]=d.extent,[u,v]=mercator3D(c);if(u<l||u>r||v<t||v>b)throw Error('坐标超出地形覆盖');const x=(u-l)/(r-l)*(d.width-1),y=(v-t)/(b-t)*(d.height-1),i=Math.min(d.width-2,Math.floor(x)),j=Math.min(d.height-2,Math.floor(y)),a=x-i,z=y-j,h=(ix,iy)=>d.elevations[iy*d.width+ix];const meters=(h(i,j)*(1-a)+h(i+1,j)*a)*(1-z)+(h(i,j+1)*(1-a)+h(i+1,j+1)*a)*z;const scale=worldWidth/(r-l);return [(u-(l+r)/2)*scale,meters/40075016.7*scale*exaggeration,(v-(t+b)/2)*scale];}
