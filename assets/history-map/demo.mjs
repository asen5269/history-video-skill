import { HistoryMap } from './src/history-map.mjs';

const $ = id => document.getElementById(id);
const scenes = await (await fetch('./data/demo-scenes.json')).json();
scenes.push(await (await fetch('./data/qing-1820.scene.json')).json());
const canvas = $('map');
let renderer, current = 0, playing = false, origin = 0, tickId = 0, token = 0;
const clock = seconds => { const m = Math.floor(seconds / 60), s = (seconds % 60).toFixed(1).padStart(4, '0'); return String(m).padStart(2, '0') + ':' + s; };

function pause() { playing = false; cancelAnimationFrame(tickId); $('play').textContent = '播放'; $('play').setAttribute('aria-label', '播放动画'); }
function seek(time) { renderer.setTime(Number(time)); $('seek').value = renderer.time; $('time').textContent = clock(renderer.time); }
function loop(now) {
  if (!playing) return;
  seek((now - origin) / 1000);
  if (renderer.time >= renderer.scene.duration) { pause(); return; }
  tickId = requestAnimationFrame(loop);
}
function play() { if (renderer.time >= renderer.scene.duration) seek(0); playing = true; origin = performance.now() - renderer.time * 1000; $('play').textContent = '暂停'; $('play').setAttribute('aria-label', '暂停动画'); tickId = requestAnimationFrame(loop); }

async function showScene(scene, index = current) {
  const generation = ++token; pause(); $('loading').hidden = false; $('loading').textContent = '正在加载地形与疆域';
  for (const id of ['play', 'restart', 'download', 'seek']) $(id).disabled = true;
  try {
    // Load offscreen, then publish the ready scene atomically. Rapid tab changes cannot corrupt the canvas.
    const offscreen = document.createElement('canvas'), candidate = new HistoryMap(offscreen, scene);
    await candidate.ready;
    if (generation !== token) return;
    current = index; renderer = candidate; renderer.canvas = canvas; renderer.ctx = canvas.getContext('2d');
    canvas.width = candidate.width; canvas.height = candidate.height;
    $('seek').max = scene.duration; $('duration').textContent = clock(scene.duration); $('scene-title').textContent = scene.name ?? scene.title;
    const year = scene.storyYear; $('scene-year').textContent = year < 0 ? '前 ' + Math.abs(year) + ' 年' : (year === undefined ? '' : year + ' 年');
    $('scene-note').textContent = scene.note ?? '拖动时间轴查看地图变化。'; $('scene-json').value = JSON.stringify(scene, null, 2);
    $('source-credit').textContent = (scene.attribution ?? '疆域：Seshat / Cliopatria（CC BY 4.0，裁切与简化）') + ' · 地形：Mapzen / USGS / NOAA · 海岸线与河流：Natural Earth';
    $('scene-tabs').querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-selected', i === index ? 'true' : 'false'));
    $('loading').hidden = true; for (const id of ['play', 'restart', 'download', 'seek']) $(id).disabled = false;
    $('editor-error').textContent = ''; seek(scene.previewTime ?? 0); window.mapDemo.renderer = renderer;
  } catch (e) { if (generation === token) { $('loading').textContent = e.message; $('editor-error').textContent = e.message; } throw e; }
}
scenes.forEach((scene, i) => {
  const button = document.createElement('button'); button.className = 'scene-tab'; button.role = 'tab'; button.textContent = scene.name;
  button.setAttribute('aria-selected', i ? 'false' : 'true'); button.addEventListener('click', () => showScene(scene, i).catch(() => {})); $('scene-tabs').append(button);
});
$('play').addEventListener('click', () => playing ? pause() : play());
$('seek').addEventListener('input', e => { pause(); seek(e.target.value); });
$('restart').addEventListener('click', () => { pause(); seek(0); });
$('fullscreen').addEventListener('click', () => document.fullscreenElement ? document.exitFullscreen() : document.querySelector('.map-stage').requestFullscreen());
$('settings').addEventListener('click', () => { const open = $('editor-panel').hidden; $('editor-panel').hidden = !open; $('settings').setAttribute('aria-expanded', String(open)); });
$('apply').addEventListener('click', async () => { try { await showScene(JSON.parse($('scene-json').value), -1); } catch (e) { $('editor-error').textContent = e.message; } });
$('import').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try { const scene = JSON.parse(await file.text()); await showScene(Array.isArray(scene) ? scene[0] : scene, -1); }
  catch (e) { $('editor-panel').hidden = false; $('editor-error').textContent = e.message; }
  e.target.value = '';
});
$('download').addEventListener('click', () => { const link = document.createElement('a'); link.href = canvas.toDataURL('image/png'); link.download = (renderer.scene.id ?? 'map') + '-' + renderer.time.toFixed(2) + '.png'; link.click(); });
window.addEventListener('keydown', e => { if (e.code === 'Space' && !['TEXTAREA', 'INPUT', 'BUTTON'].includes(document.activeElement.tagName)) { e.preventDefault(); if (renderer?.loaded) playing ? pause() : play(); } });
window.mapDemo = { renderer: null, scenes, showScene: i => showScene(scenes[i], i), seek: t => { pause(); seek(t); }, pause, play };
const selected = Math.max(0, scenes.findIndex(scene => scene.id === new URL(location.href).searchParams.get('scene')));
await showScene(scenes[selected], selected);
