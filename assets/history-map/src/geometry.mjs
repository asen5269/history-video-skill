export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const smooth = x => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };
export function mercator([longitude, latitude]) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 85.051129)
    throw new Error('地图坐标须为有效的[经度,纬度]');
  const a = latitude * Math.PI / 180;
  return [(longitude + 180) / 360, (1 - Math.asinh(Math.tan(a)) / Math.PI) / 2];
}
export function cameraAt(keys, time) {
  if (!keys?.length) throw new Error('缺少镜头关键帧');
  let a = keys[0], b = a;
  for (const key of keys) { if (key.time <= time) a = key; else { b = key; break; } b = a; }
  const t = b.time > a.time ? smooth((time - a.time) / (b.time - a.time)) : 0;
  const p = mercator(a.center), q = mercator(b.center);
  return { center: p.map((v, i) => v + (q[i] - v) * t), span: a.span + (b.span - a.span) * t };
}
export function geometryPath(geometry, Path = globalThis.Path2D) {
  const path = new Path();
  const line = (coordinates, close) => {
    coordinates.forEach((coordinate, i) => { const p = mercator(coordinate); i ? path.lineTo(...p) : path.moveTo(...p); });
    if (close) path.closePath();
  };
  switch (geometry.type) {
    case 'Polygon': geometry.coordinates.forEach(r => line(r, true)); break;
    case 'MultiPolygon': geometry.coordinates.forEach(p => p.forEach(r => line(r, true))); break;
    case 'LineString': line(geometry.coordinates, false); break;
    case 'MultiLineString': geometry.coordinates.forEach(r => line(r, false)); break;
    case 'GeometryCollection': geometry.geometries.forEach(g => path.addPath(geometryPath(g, Path))); break;
    default: throw new Error('不支持的地图几何类型：' + geometry.type);
  }
  return path;
}
export function routeSlice(coordinates, progress) {
  const points = coordinates.map(mercator), lengths = [0];
  for (let i = 1; i < points.length; i++) lengths[i] = lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  const end = lengths.at(-1) * clamp(progress, 0, 1), out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (lengths[i] <= end) out.push(points[i]);
    else {
      const distance = lengths[i] - lengths[i - 1], t = distance ? (end - lengths[i - 1]) / distance : 0;
      out.push(points[i - 1].map((v, k) => v + (points[i][k] - v) * t)); break;
    }
  }
  return out;
}
