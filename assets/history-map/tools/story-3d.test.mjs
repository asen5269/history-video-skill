import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mercator3D,terrainPoint3D,cameraAt3D,validateStory3D} from '../src/story-3d.mjs';
const d={width:2,height:2,extent:[0,0,1,1],elevations:[0,100,200,300]};
test('经纬度与网格中心高度双线性采样一致',()=>{assert.deepEqual(mercator3D([0,0]),[.5,.5]);const p=terrainPoint3D(d,[0,0],160,1);assert.equal(p[0],0);assert.equal(p[2],0);assert.ok(Math.abs(p[1]-150/40075016.7*160)<1e-12);assert.throws(()=>terrainPoint3D({...d,extent:[.6,.6,.8,.8]},[0,0]),/覆盖/);});
test('倒拖帧使用同一镜头位置，首尾停驻',()=>{const keys=[{time:0,position:[0,10,20],target:[0,0,0]},{time:10,position:[10,20,30],target:[2,0,0]}];const before=cameraAt3D(keys,3);cameraAt3D(keys,8);assert.deepEqual(cameraAt3D(keys,3),before);assert.deepEqual(cameraAt3D(keys,5).position,[5,15,25]);assert.deepEqual(cameraAt3D(keys,12),keys[1]);});
test('任意地点可接入，覆盖不足与无依据区域被拒绝',()=>{const s={duration:5,camera:[{time:0,position:[0,1,2],target:[0,0,0]}],places:[{id:'a',coordinates:[120,30]},{id:'b',coordinates:[90,40]}]};validateStory3D(s,d);assert.throws(()=>validateStory3D(s,{...d,extent:[.8,.3,.9,.4]}),/覆盖/);assert.throws(()=>validateStory3D({...s,regions:[{geometry:{type:'Polygon',coordinates:[]}}]},d),/来源/);assert.throws(()=>validateStory3D({...s,routes:[{coordinates:[[120,30],[90,40]]}]},d),/含义/);});
