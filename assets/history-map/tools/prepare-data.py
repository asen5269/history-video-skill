"""Prepare local, georeferenced map assets from real DEM and vector data."""
import argparse
import hashlib
import io
import json
import math
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import urlopen, Request
import numpy as np
from PIL import Image, ImageDraw
from shapely.geometry import shape, mapping, box

ap = argparse.ArgumentParser()
ap.add_argument('--cache', required=True)
ap.add_argument('--years', type=int, nargs='+', default=[-300, 1200, 1300, 1820])
ap.add_argument('--boundaries-only', action='store_true')
args = ap.parse_args()
root = Path(__file__).resolve().parents[1]
out = root / 'data'
cache = Path(args.cache)
out.mkdir(parents=True, exist_ok=True)
cache.mkdir(parents=True, exist_ok=True)
sources = json.loads((out / 'sources.json').read_text('utf-8-sig')) if args.boundaries_only and (out / 'sources.json').exists() else []

def fetch(url, name):
    path = cache / name
    if not path.exists():
        for attempt in range(3):
            try:
                with urlopen(Request(url, headers={'User-Agent': 'history-map-component/1.0'}), timeout=40) as response:
                    content = response.read()
                path.write_bytes(content)
                break
            except Exception:
                if attempt == 2:
                    raise
    return path.read_bytes()

def write(name, value):
    (out / name).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), 'utf8')

z, n = 6, 64
lonlat = (65, 7, 147, 64)
def world(lon, lat):
    a = math.radians(lat)
    return (lon + 180) / 360, (1 - math.asinh(math.tan(a)) / math.pi) / 2

x0, y1 = world(lonlat[0], lonlat[1])
x1, y0 = world(lonlat[2], lonlat[3])
tx0, tx1 = math.floor(x0*n), math.ceil(x1*n)-1
ty0, ty1 = math.floor(y0*n), math.ceil(y1*n)-1
extent = [tx0/n, ty0/n, (tx1+1)/n, (ty1+1)/n]
def latitude(y):
    return math.degrees(math.atan(math.sinh(math.pi*(1-2*y))))
bounds = [extent[0]*360-180, latitude(extent[3]), extent[2]*360-180, latitude(extent[1])]
area = box(*bounds)

ne = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'
vectors = {}
for name, remote in ([] if args.boundaries_only else [('land', 'ne_10m_land.geojson'), ('rivers', 'ne_10m_rivers_lake_centerlines.geojson')]):
    url = ne + remote
    content = fetch(url, remote)
    source = json.loads(content)
    features = []
    for f in source['features']:
        geom = shape(f['geometry'])
        if geom.intersects(area):
            cropped = geom.intersection(area).simplify(0.008, preserve_topology=True)
            if not cropped.is_empty:
                props = {'name': f.get('properties', {}).get('name', ''), 'rank': f.get('properties', {}).get('scalerank', 1)}
                features.append({'type': 'Feature', 'properties': props, 'geometry': mapping(cropped)})
    vectors[name] = {'type': 'FeatureCollection', 'features': features}
    write(name + '.geojson', vectors[name])
    sources.append({'name': 'Natural Earth ' + name, 'url': url, 'license': 'Public domain', 'sha256': hashlib.sha256(content).hexdigest(), 'modifications': 'East Asia crop; 0.008 degree simplification; properties reduced'})
    print(name, len(features), flush=True)

url = 'https://raw.githubusercontent.com/Seshat-Global-History-Databank/cliopatria/main/cliopatria.geojson.zip'
content = fetch(url, 'cliopatria.geojson.zip')
with zipfile.ZipFile(io.BytesIO(content)) as archive:
    original = json.loads(archive.read(next(name for name in archive.namelist() if name.endswith('.geojson'))))
for year in args.years:
    features = []
    for f in original['features']:
        props = f['properties']
        if props['Type'] != 'POLITY' or not props['FromYear'] <= year <= props['ToYear']:
            continue
        geom = shape(f['geometry'])
        if not geom.is_valid:
            geom = geom.buffer(0)
        if geom.intersects(area):
            cropped = geom.intersection(area).simplify(0.015, preserve_topology=True)
            if not cropped.is_empty and cropped.area > 0:
                label_geom = max(cropped.geoms, key=lambda g: g.area) if cropped.geom_type == 'MultiPolygon' else cropped
                label_point = label_geom.representative_point()
                features.append({'type': 'Feature', 'properties': {'id': props['Name'], 'year': year, 'sourceName': props['Name'], 'fromYear': props['FromYear'], 'toYear': props['ToYear'], 'label': [label_point.x, label_point.y]}, 'geometry': mapping(cropped)})
    write(f'boundaries-{year}.geojson', {'type': 'FeatureCollection', 'features': features})
    sources = [s for s in sources if s['name'] != f'Cliopatria {year}']
    sources.append({'name': f'Cliopatria {year}', 'url': url, 'year': year, 'license': 'CC BY 4.0', 'attribution': 'Seshat Global History Databank, Cliopatria; modified by crop and simplification', 'sha256': hashlib.sha256(content).hexdigest(), 'modifications': 'POLITY records only; exact valid year; East Asia crop; 0.015 degree simplification; properties reduced', 'precision': 'Historical reconstruction for overview; not a detailed battle boundary'})
    print('boundaries', year, [f['properties']['id'] for f in features], flush=True)

if args.boundaries_only:
    write('sources.json', sources)
    raise SystemExit(0)

w, h = (tx1-tx0+1)*256, (ty1-ty0+1)*256
dem = np.zeros((h, w), dtype=np.float32)
tiles = [(x, y) for y in range(ty0, ty1+1) for x in range(tx0, tx1+1)]
def tile(pair):
    x, y = pair
    url = f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
    rgb = np.asarray(Image.open(io.BytesIO(fetch(url, f'dem-{z}-{x}-{y}.png'))).convert('RGB'), dtype=np.float32)
    return x, y, rgb[:, :, 0]*256 + rgb[:, :, 1] + rgb[:, :, 2]/256 - 32768

with ThreadPoolExecutor(max_workers=8) as pool:
    for i, (x, y, elevations) in enumerate(pool.map(tile, tiles)):
        dem[(y-ty0)*256:(y-ty0+1)*256, (x-tx0)*256:(x-tx0+1)*256] = elevations
        if i % 25 == 0:
            print('DEM', i+1, '/', len(tiles), flush=True)

mask_image = Image.new('L', (w, h))
draw = ImageDraw.Draw(mask_image)
def pixels(ring):
    return [((world(*p[:2])[0]-extent[0])*n*256, (world(*p[:2])[1]-extent[1])*n*256) for p in ring]
for f in vectors['land']['features']:
    g = f['geometry']
    polygons = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']
    for polygon in polygons:
        draw.polygon(pixels(polygon[0]), fill=255)
        for hole in polygon[1:]:
            draw.polygon(pixels(hole), fill=0)
land = np.asarray(mask_image) > 0
rows = (np.arange(h) + ty0*256) / (n*256)
lats = np.arctan(np.sinh(np.pi*(1-2*rows)))
meters_per_pixel = (40075016.6856/(n*256))*np.cos(lats)
dy, dx = np.gradient(dem)
dx = dx/meters_per_pixel[:, None]*4.0
dy = dy/meters_per_pixel[:, None]*4.0
norm = np.sqrt(dx*dx + dy*dy + 1)
light = (-dx*-0.55 - dy*-0.55 + 0.63)/norm
relief = np.clip((light - 0.63)*100, -52, 35)
base = np.array([224, 220, 206], dtype=np.float32)
rgb = np.broadcast_to(base, (h, w, 3)).copy() + relief[:, :, None]
# A deterministic fine paper grain, independent of animation time.
rng = np.random.default_rng(17)
rgb += rng.normal(0, 0.7, (h, w, 1))
rgb[~land] = [158, 188, 207]
Image.fromarray(np.clip(rgb, 0, 255).astype('uint8')).save(out / 'terrain.webp', quality=94, method=6)
write('basemap.json', {'image': 'terrain.webp', 'bounds': bounds, 'extent': extent, 'projection': 'EPSG:3857', 'width': w, 'height': h, 'land': 'land.geojson', 'rivers': 'rivers.geojson'})
sources.append({'name': 'Mapzen Terrain Tiles', 'url': 'https://registry.opendata.aws/terrain-tiles/', 'tiles': f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{{x}}/{{y}}.png', 'bounds': bounds, 'license': 'Multiple source datasets; see attribution', 'attribution': 'Global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey; global ETOPO1 terrain data U.S. National Oceanic and Atmospheric Administration', 'modifications': 'Terrarium DEM decoded; hillshade with 4x vertical exaggeration; modern land mask; custom colors'})
if (out / 'kublai.jpg').exists():
    sources.append({'name': '元代帝半身像册·元世祖皇帝像', 'url': 'https://commons.wikimedia.org/wiki/File:YuanEmperorAlbumKhubilaiPortrait.jpg', 'institution': 'National Palace Museum, Taipei', 'date': 'circa 1294, posthumous portrait', 'license': 'Public domain (PD-Art)', 'usage': 'Historical portrait overlay; does not identify the ruler in 1300', 'sha256': hashlib.sha256((out / 'kublai.jpg').read_bytes()).hexdigest()})
write('sources.json', sources)
print('ready', w, h, flush=True)
