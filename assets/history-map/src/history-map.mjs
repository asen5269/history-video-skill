import {fitCamera,placeLabel} from './layout.mjs';
import { mercator, cameraAt, geometryPath, routeSlice, clamp, smooth } from './geometry.mjs';

const DEFAULT_ROOT = new URL('../', import.meta.url);
const FONT = '"STKaiti","KaiTi","楷体",serif';
const json = async url => { const r = await fetch(url); if (!r.ok) throw new Error('地图数据加载失败：' + url); return r.json(); };
const image = url => new Promise((resolve, reject) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => resolve(img); img.onerror = () => reject(new Error('地图素材加载失败：' + url)); img.src = url; });

/** Canvas component: all visible state is a function of scene data and time. */
export class HistoryMap {
  constructor(canvas, scene, { width = 1920, height = 1080, baseUrl = DEFAULT_ROOT } = {}) {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('HistoryMap需要canvas');
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    canvas.width = width; canvas.height = height;
    this.width = width; this.height = height; this.baseUrl = new URL(baseUrl, location.href);
    this.scene = scene; this.time = 0; this.loaded = false;
    this.ready = this.load(scene);
  }
  async load(scene) {
    if(scene.autoFit&&!scene.camera?.length)scene={...scene,camera:[{time:0,center:[0,0],span:360}]};
    if (!Number.isFinite(scene.duration) || scene.duration <= 0) throw new Error('镜头duration须为正数');
    if (!scene.camera?.length || scene.camera.some((k, i) => !Number.isFinite(k.time) || !Number.isFinite(k.span) || k.span <= 0 || (i && k.time <= scene.camera[i - 1].time)))
      throw new Error('镜头关键帧需要递增time、有效center和正span');
    scene.camera.forEach(k => mercator(k.center));
    this.scene = structuredClone(scene); this.loaded = false;
    scene = this.scene;
    const url = path => new URL(path, this.baseUrl);
    this.basemap = await json(url(scene.basemap ?? 'data/basemap.json'));
    const baseDir = new URL('./', url(scene.basemap ?? 'data/basemap.json'));
    const [terrain, land, rivers, boundaries, subdivisions] = await Promise.all([
      image(new URL(this.basemap.image, baseDir)), json(new URL(this.basemap.land, baseDir)),
      json(new URL(this.basemap.rivers, baseDir)), typeof scene.boundaries === 'string' ? json(url(scene.boundaries)) : Promise.resolve(scene.boundaries ?? { features: [] }),
      scene.subdivisions ? json(url(scene.subdivisions.source)) : Promise.resolve({ features: [] })
    ]);
    await document.fonts.load('48px ' + FONT); await document.fonts.ready;
    this.terrain = terrain;
    this.land = new Path2D(); land.features.forEach(f => this.land.addPath(geometryPath(f.geometry)));
    this.rivers = rivers.features.map(f => ({ path: geometryPath(f.geometry), rank: f.properties.rank ?? 1 }));
    this.features = new Map();
    for (const f of [...boundaries.features, ...subdivisions.features]) {
      const id = f.properties.id ?? f.properties.Name ?? f.properties.NAME;
      if (!this.features.has(id)) this.features.set(id, []);
      this.features.get(id).push(f.geometry);
    }
    this.paths = new Map();
    this.regions = [...(scene.regions ?? []), ...(scene.subdivisions?.regions ?? [])];
    for (const region of this.regions) {
      for (const state of [region, ...(region.states ?? [])]) {
        if (state.label === 'auto') state.label = [...boundaries.features, ...subdivisions.features].find(f => (f.properties.id ?? f.properties.Name ?? f.properties.NAME) === (state.featureId ?? region.featureId))?.properties.label;
        if (state.label) mercator(state.label);
        const geometries = state.geometry ? [state.geometry] : this.features.get(state.featureId ?? region.featureId);
        if (!geometries?.length) throw new Error('找不到疆域几何：' + (state.featureId ?? region.featureId));
        const path = new Path2D(); geometries.forEach(g => path.addPath(geometryPath(g)));
        this.paths.set(state, path);
      }
    }
    if(scene.autoFit){const ids=scene.autoFit.featureIds??this.regions.map(r=>r.featureId);const geometries=ids.flatMap(id=>this.features.get(id)??[]);const fitted=fitCamera(geometries,{padding:scene.autoFit.padding});scene.camera=[fitted,{...fitted,time:scene.duration}];}
    (scene.places ?? []).forEach(p => mercator(p.coordinates));
    (scene.flags ?? []).forEach(p => mercator(p.coordinates));
    (scene.routes ?? []).forEach(r => { if (r.coordinates.length < 2) throw new Error('路线至少两个坐标'); r.coordinates.forEach(mercator); });
    this.portraits = await Promise.all((scene.portraits ?? []).map(async p => ({ ...p, image: await image(url(p.src)) })));
    if(this.disposed)return this;
    this.loaded = true; this.setTime(this.time); return this;
  }
  setTime(seconds) {
    if (!Number.isFinite(seconds)) throw new Error('时间须为有限数值');
    this.time = clamp(seconds, 0, this.scene.duration);
    if (this.loaded) this.draw();
    return this;
  }
  setFrame(frame, fps = 30) {
    if (!Number.isFinite(fps) || fps <= 0) throw new Error('fps须为正数');
    return this.setTime(frame / fps);
  }
  dispose() { this.disposed = true; this.loaded = false; }
  project(coordinates) {
    const p = mercator(coordinates); return [p[0] * this.scale + this.tx, p[1] * this.scale + this.ty];
  }
  opacity(item) {
    const start = item.start ?? 0, end = item.end ?? this.scene.duration, fade = item.fade ?? 0.6;
    if (this.time < start || this.time > end) return 0;
    return fade > 0 ? smooth((this.time - start) / fade) : 1;
  }
  screen() { this.ctx.setTransform(this.width / 1920, 0, 0, this.height / 1080, 0, 0); }
  map() { this.ctx.setTransform(this.scale, 0, 0, this.scale, this.tx, this.ty); }
  text(text, x, y, size, { color = '#191f20', halo = '#efece1', align = 'center', rotation = 0, vertical = false } = {}) {
    const c = this.ctx; c.save(); c.translate(x, y); c.rotate(rotation * Math.PI / 180);
    c.font = '600 ' + size + 'px ' + FONT; c.textAlign = align; c.textBaseline = 'middle';
    c.lineJoin = 'round'; c.lineWidth = Math.max(2.5, size * 0.055); c.strokeStyle = halo; c.fillStyle = color;
    const draw = (s, yy) => { if (halo) c.strokeText(s, 0, yy); c.fillText(s, 0, yy); };
    if (vertical) [...text].forEach((ch, i) => draw(ch, (i - ([...text].length - 1) / 2) * size * 1.06)); else draw(text, 0);
    c.restore();
  }
  logical(coordinates) { const p = this.project(coordinates); return [p[0] * 1920 / this.width, p[1] * 1080 / this.height]; }
  draw() {
    const c = this.ctx, scene = this.scene, time = this.time;
    const camera = cameraAt(scene.camera, time);
    camera.span/=Math.max(.5,Math.min(4,scene.zoom??1));
    this.currentSpan=camera.span;this.labelQueue=[];this.occupied=structuredClone(scene.labelObstacles??[]);
    if(scene.labelLayout!==false){this.occupied.push({x:1800,y:900,w:120,h:180});}
    this.scale = this.width / (camera.span / 360);
    this.tx = this.width / 2 - camera.center[0] * this.scale; this.ty = this.height / 2 - camera.center[1] * this.scale;
    c.resetTransform(); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#9ebccf'; c.fillRect(0, 0, this.width, this.height);
    this.map();
    const [x0, y0, x1, y1] = this.basemap.extent;
    c.drawImage(this.terrain, x0, y0, x1 - x0, y1 - y0);
    if (scene.theme === 'neutral') {
      c.save(); c.clip(this.land, 'evenodd'); c.fillStyle = 'rgba(150,144,151,0.56)'; c.fillRect(x0, y0, x1 - x0, y1 - y0); c.restore();
    }
    const states = [];
    for (const region of this.regions) {
      const opacity = this.opacity(region); if (!opacity) continue;
      const state = [...(region.states ?? [])].filter(s => s.time <= time).at(-1) ?? region;
      const active = { ...region, ...state }; states.push(active);
      c.save(); c.clip(this.land, 'evenodd'); c.globalCompositeOperation = 'multiply';
      c.globalAlpha = opacity * (active.opacity ?? 0.72); c.fillStyle = active.color ?? '#9f9d9c';
      c.fill(this.paths.get(state), 'evenodd'); c.globalCompositeOperation = 'source-over'; c.globalAlpha = opacity;
      c.lineWidth = (active.strokeWidth ?? 2) / this.scale * this.width / 1920;
      c.lineJoin = 'round';
      c.setLineDash((active.dash ?? []).map(v => v / this.scale * this.width / 1920));
      c.strokeStyle = active.stroke ?? (scene.theme === 'neutral' ? '#efece4' : '#4c514a'); c.stroke(this.paths.get(state)); c.restore();
    }
    c.save(); c.clip(this.land, 'evenodd'); c.strokeStyle = scene.riverColor ?? '#459eb9'; c.globalAlpha = 0.88;
    for (const river of this.rivers) {
      if (river.rank > (scene.riverRank ?? 3)) continue;
      c.lineWidth = (river.rank < 2 ? 2.3 : 1.2) / this.scale * this.width / 1920; c.stroke(river.path);
    }
    c.restore();
    c.lineWidth = 1.4 / this.scale * this.width / 1920; c.strokeStyle = 'rgba(255,253,236,0.78)'; c.stroke(this.land);
    for (const route of scene.routes ?? []) {
      if (time < (route.start ?? 0)) continue;
      const progress = clamp((time - (route.start ?? 0)) / (route.duration ?? 5), 0, 1);
      const points = routeSlice(route.coordinates, progress); c.save(); c.beginPath();
      points.forEach((p, i) => i ? c.lineTo(...p) : c.moveTo(...p));
      c.lineWidth = (route.width ?? 5) / this.scale * this.width / 1920; c.strokeStyle = route.color ?? '#a4412d';
      c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(); c.restore();
      this.screen(); const last = points.at(-1), p = [(last[0] * this.scale + this.tx) * 1920 / this.width, (last[1] * this.scale + this.ty) * 1080 / this.height];
      c.fillStyle = route.color ?? '#a4412d'; c.beginPath(); c.arc(...p, 7, 0, Math.PI * 2); c.fill(); this.map();
    }
    this.screen();
    if(scene.labelLayout!==false)for(const f of scene.flags??[]){if(!this.opacity(f))continue;const [x,y]=this.logical(f.coordinates);this.occupied.push({x:x+(f.dx??0)-8,y:y+(f.dy??0)-(f.height??244)-25,w:(f.width??90)+24,h:(f.height??244)+35});}
    for (const region of states) {
      if (!region.label || (region.maxSpan!==undefined && this.currentSpan>region.maxSpan)) continue; const p = this.logical(region.label); p[0] += region.labelOffset?.[0] ?? 0; p[1] += region.labelOffset?.[1] ?? 0;
      c.save(); c.globalAlpha = this.opacity(region);
      this.label(region.name,...p,region.labelSize??90,{rotation:region.rotation??0,halo:region.halo??'#ece9dd',vertical:region.vertical},region.priority??40); c.restore();
      if (region.labelCaption) {
        c.save(); c.globalAlpha = this.opacity(region);
        this.label(region.labelCaption, p[0], p[1] + (region.labelSize ?? 90) * 0.85, region.captionSize ?? 19, { color:'#4d554d', halo:region.halo ?? '#ece9dd' },30); c.restore();
      }
    }
    for (const place of scene.places ?? []) {
      const alpha = this.opacity(place); if (!alpha || this.currentSpan>(place.maxSpan??(place.kind==='capital'?180:50))) continue;
      const p = this.logical(place.coordinates); c.save(); c.globalAlpha = alpha;
      c.beginPath(); c.arc(...p, 8, 0, Math.PI * 2); c.strokeStyle = '#e9e5d3'; c.lineWidth = 2; c.fillStyle = '#25363b'; c.fill(); c.stroke();
      this.label(place.name,p[0]+(place.dx??15),p[1]+(place.dy??25),place.size??30,{align:place.align??'left'},place.priority??80,p); c.restore();
    }
    for (const flag of scene.flags ?? []) this.flag(flag);
    for (const p of this.portraits) this.portrait(p);
    this.flushLabels();
    if (scene.title) this.heading();
    this.compass();
    if (scene.caption) this.text(scene.caption, 960, 1027, 39, { color: '#fffdf6', halo: '#1b2223' });
  }
  label(text,x,y,size,options={},priority=40,anchor=null){if(this.scene.labelLayout===false)return this.text(text,x,y,size,options);const c=this.ctx;c.font='600 '+size+'px '+FONT;const w=options.vertical?size:c.measureText(text).width,h=options.vertical?[...text].length*size*1.06:size*1.25;if(options.align==='left')x+=w/2;if(options.align==='right')x-=w/2;this.labelQueue.push({text,x,y,size,options:{...options,align:'center'},priority,anchor,w,h,alpha:c.globalAlpha});}
  flushLabels(){for(const label of this.labelQueue.sort((a,b)=>b.priority-a.priority)){const location=placeLabel(label,this.occupied);if(!location)continue;this.ctx.save();this.ctx.globalAlpha=label.alpha;if(label.anchor&&(Math.abs(location.x-label.x)>5||Math.abs(location.y-label.y)>5)){this.ctx.strokeStyle='#606d66';this.ctx.lineWidth=1;this.ctx.beginPath();this.ctx.moveTo(...label.anchor);this.ctx.lineTo(location.x,location.y);this.ctx.stroke();}this.text(label.text,location.x,location.y,label.size,label.options);this.ctx.restore();}}
  flag(flag) {
    const alpha = this.opacity(flag); if (!alpha) return;
    const c = this.ctx, [x, y] = this.logical(flag.coordinates), color = flag.color ?? '#984632';
    const height = flag.height ?? 244, width = flag.width ?? 90, cloth = height * 0.76;
    const wave = Math.sin(this.time * 2.3 + (flag.phase ?? 0)) * 6;
    c.save(); c.globalAlpha = alpha; c.translate(x + (flag.dx ?? 0), y + (flag.dy ?? 0));
    c.strokeStyle = '#3a4140'; c.lineWidth = 4; c.beginPath(); c.moveTo(0, 0); c.lineTo(0, -height - 10); c.stroke();
    c.fillStyle = color; c.beginPath(); c.arc(0, -height - 12, 8, 0, Math.PI * 2); c.fill();
    const clothPath = inset => {
      const left = inset, right = width - inset, top = -height + inset, bottom = -height + cloth - inset;
      const p = new Path2D(); p.moveTo(left, top); p.bezierCurveTo(width*0.4, top + wave + 9, width*0.65, top + wave, right, top - 4);
      p.lineTo(right, bottom); p.bezierCurveTo(width*0.6, bottom + 15 + wave, width*0.35, bottom + 12, left, bottom - 2); p.closePath(); return p;
    };
    c.fillStyle = color; c.shadowColor = '#29313135'; c.shadowBlur = 12; c.shadowOffsetY = 5; c.fill(clothPath(0));
    c.shadowBlur = 0; c.shadowOffsetY = 0; c.lineWidth = 3; c.strokeStyle = '#fbf1d5b0'; c.stroke(clothPath(2));
    c.fillStyle = flag.paper ?? '#f0e3c3'; c.globalAlpha = alpha * 0.87; c.fill(clothPath(10)); c.globalAlpha = alpha;
    for (let i = 0; i < 7; i++) { const yy = -height + 12 + i * (cloth - 22)/7; c.fillStyle = color; c.fillRect(width - 2, yy, 10 + wave*0.3, 7); }
    const size = flag.fontSize ?? Math.min(40, (cloth - 28) / [...flag.name].length);
    this.text(flag.name, width / 2 + 1, -height + cloth / 2 + 2, size, { vertical: true, halo: null, color: '#172b2b' });
    c.fillStyle = '#172b2b'; c.beginPath(); c.arc(0, 0, 8, 0, Math.PI*2); c.fill(); c.strokeStyle = '#fff7df'; c.lineWidth = 2; c.stroke();
    if (flag.place) this.text(flag.place, flag.placeDx ?? -13, flag.placeDy ?? 28, 29, { align: 'right' });
    if (flag.dx || flag.dy) {
      c.strokeStyle = '#23312b'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(0, 0); c.lineTo(-(flag.dx ?? 0), -(flag.dy ?? 0)); c.stroke();
      c.beginPath(); c.arc(-(flag.dx ?? 0), -(flag.dy ?? 0), 5, 0, Math.PI * 2); c.fill();
    }
    c.restore();
  }
  portrait(p) {
    const c = this.ctx, alpha = this.opacity(p); if (!alpha) return;
    const [x, y, w, h] = p.rect; c.save(); c.globalAlpha = alpha;
    if (p.circle) { c.beginPath(); c.ellipse(x + w/2, y + h/2, w/2, h/2, 0, 0, Math.PI*2); c.clip(); }
    const scale = Math.max(w / p.image.width, h / p.image.height), sw = w / scale, sh = h / scale;
    c.drawImage(p.image, (p.image.width-sw)/2, (p.image.height-sh)/2, sw, sh, x, y, w, h); c.restore();
    if (p.name) {
      c.save(); c.globalAlpha = alpha; c.fillStyle = '#9e3429'; c.fillRect(x + w + 15, y + 24, 64, Math.max(150, [...p.name].length*45 + 26));
      this.text(p.name, x + w + 47, y + 24 + Math.max(150, [...p.name].length*45 + 26)/2, 40, { vertical: true, color: '#fff4d9', halo: null }); c.restore();
    }
  }
  heading() {
    const c = this.ctx, s = this.scene;
    c.save(); c.fillStyle = '#713d2de8'; c.beginPath(); c.roundRect(0, 25, Math.min(1140, 310 + [...s.title].length * 47), 92, [0, 34, 34, 0]); c.fill();
    this.text(s.title, 42, 73, 51, { align: 'left', color: '#f4e6bf', halo: null });
    const storyYear = (s.years ?? []).filter(k => k.time <= this.time).at(-1)?.year ?? s.storyYear;
    if (storyYear !== undefined) {
      const year = storyYear < 0 ? '公元前 ' + Math.abs(storyYear) + ' 年' : '公元 ' + storyYear + ' 年';
      this.text(year, 1875, 62, 28, { align: 'right', color: '#343c3c', halo: '#eee9dc' });
    }
    c.restore();
  }
  compass() {
    const c = this.ctx; c.save(); c.translate(1850, 930); c.globalAlpha = 0.7;
    c.fillStyle = '#f4eedc'; c.strokeStyle = '#445455'; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, -32); c.lineTo(11, 18); c.lineTo(0, 9); c.lineTo(-11, 18); c.closePath(); c.fill(); c.stroke();
    this.text('北', 0, -52, 20, { halo: null, color: '#354648' }); c.restore();
  }
}
