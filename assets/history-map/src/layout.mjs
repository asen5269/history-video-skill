import {mercator} from './geometry.mjs';
export function fitCamera(geometries,{width=1920,height=1080,padding={left:100,right:100,top:220,bottom:150}}={}){
 const points=[];const walk=v=>{if(typeof v[0]==='number')points.push(mercator(v));else v.forEach(walk);};geometries.forEach(g=>walk(g.coordinates));if(!points.length)throw Error('自动取景缺少几何');
 const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),l=Math.min(...xs),r=Math.max(...xs),t=Math.min(...ys),b=Math.max(...ys);
 const p={left:100,right:100,top:220,bottom:150,...padding},w=width-p.left-p.right,h=height-p.top-p.bottom;if(w<=0||h<=0)throw Error('取景安全区过大');
 const scale=Math.min(w/Math.max(r-l,1e-7),h/Math.max(b-t,1e-7));const cx=(l+r)/2+(width/2-(p.left+w/2))/scale,cy=(t+b)/2+(height/2-(p.top+h/2))/scale;
 return {time:0,center:[cx*360-180,Math.atan(Math.sinh(Math.PI*(1-2*cy)))*180/Math.PI],span:width/scale*360};
}
export const intersects=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
export function placeLabel(label,occupied,width=1920,height=1080){const shifts=[[0,0],[0,-label.h-12],[0,label.h+12],[label.w/2+18,0],[-label.w/2-18,0]];for(const [dx,dy]of shifts){const x=label.x+dx,y=label.y+dy,box={x:x-label.w/2-5,y:y-label.h/2-4,w:label.w+10,h:label.h+8};if(box.x<20||box.y<20||box.x+box.w>width-20||box.y+box.h>height-35||occupied.some(b=>intersects(box,b)))continue;occupied.push(box);return {x,y};}return null;}
