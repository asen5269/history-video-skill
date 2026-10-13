"""Prepare CHGIS V6 historical administrative polygons for the Qing 1820 scene."""
import argparse
import hashlib
import io
import json
from pathlib import Path
import sys
from urllib.request import urlopen
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--cache', type=Path, required=True)
args = parser.parse_args()
sys.path.insert(0, str(args.cache / 'python'))
import shapefile
from pyproj import CRS, Transformer
from shapely import make_valid
from shapely.geometry import shape, mapping, Point
from shapely.ops import transform, unary_union

out = Path(__file__).resolve().parents[1] / 'data'
def write(name, value):
    (out / name).write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')

def read_layer(topic, file_id):
    path = args.cache / f'v6_1820_prov_{topic}_utf.zip'
    if not path.exists():
        path.write_bytes(urlopen(f'https://dataverse.harvard.edu/api/access/datafile/{file_id}', timeout=60).read())
    archive = zipfile.ZipFile(path)
    reader = shapefile.Reader(**{
        ext: io.BytesIO(archive.read(next(n for n in archive.namelist() if n.endswith('.' + ext))))
        for ext in ('shp', 'shx', 'dbf')
    }, encoding='utf-8')
    prj = archive.read(next(n for n in archive.namelist() if n.endswith('.prj'))).decode()
    return reader, prj, path

points, _, _ = read_layer('pts', 2966723)
kinds = {r.record.as_dict()['NAME_CH'].removesuffix('省'): r.record.as_dict()['TYPE_CH'] for r in points.iterShapeRecords()}
polygons, prj, path = read_layer('pgn', 2966720)
project = Transformer.from_crs(CRS.from_wkt(prj), 'EPSG:4326', always_xy=True).transform
features, territory = [], []
for record in polygons.iterShapeRecords():
    p = record.record.as_dict()
    if int(p['SYS_ID']) >= 25047:  # Offshore geographic features, not administrative provinces.
        continue
    geo = make_valid(transform(project, shape(record.shape.__geo_interface__)))
    label = [p['X_COORD'], p['Y_COORD']]
    if not geo.covers(Point(label)):
        label = list(geo.representative_point().coords[0])
    pending = p['NAME_PY'] == 'Nibuchu'
    features.append({'type':'Feature', 'properties':{
        'id':'chgis-' + p['SYS_ID'], 'name':p['NAME_CH'],
        'kind':'pending' if pending else ('province' if kinds.get(p['NAME_CH']) == '省' else 'region'),
        'administration':kinds.get(p['NAME_CH'], ''), 'label':label, 'year':1820
    }, 'geometry':mapping(geo.simplify(0.012, preserve_topology=True))})
    if not pending:
        territory.append(geo)
assert sum(f['properties']['kind'] == 'province' for f in features) == 18
write('qing-1820-admin.geojson', {'type':'FeatureCollection', 'features':features})
countries = json.loads((out / 'boundaries-1820.geojson').read_text(encoding='utf-8'))
countries['features'] = [f for f in countries['features'] if (f['properties'].get('id') or f['properties'].get('Name')) != 'Qing Dynasty']
countries['features'].append({'type':'Feature', 'properties':{'id':'qing-1820-outline', 'Name':'Qing Dynasty'},
    'geometry':mapping(unary_union(territory).simplify(0.008, preserve_topology=True))})
write('qing-1820-countries.geojson', countries)
sources = json.loads((out / 'sources.json').read_text(encoding='utf-8-sig'))
sources = [s for s in sources if s['name'] != 'CHGIS V6 1820 administrative divisions']
sources.append({
    'name':'CHGIS V6 1820 administrative divisions', 'year':1820,
    'url':'https://doi.org/10.7910/DVN/ST5KKM',
    'files':{'polygons':'https://dataverse.harvard.edu/api/access/datafile/2966720', 'points':'https://dataverse.harvard.edu/api/access/datafile/2966723'},
    'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
    'attribution':'CHGIS Version 6. Fairbank Center for Chinese Studies, Harvard University; Institute for Chinese Historical Geography, Fudan University, Dec 2016.',
    'license':'Dataverse metadata lists CC0 1.0; bundled CHGIS V6 EULA limits use to non-commercial research and education. Commercial use or redistribution requires separate permission.',
    'licenseUrl':'https://dataverse.harvard.edu/api/access/datafile/2966721',
    'modifications':'Xian 1980 Gauss-Kruger Zone 19 reprojected to WGS84; geometry repaired; 0.012-degree simplification; properties reduced. Qing outline dissolved from 26 administrative areas. Five offshore geographic features excluded from province layer.',
    'precision':'Historical administrative reconstruction, not modern boundaries or a claim of uniform control. Nerchinsk treaty pending area kept separate with dashed outline.'
})
write('sources.json', sources)
print('1820:', len(features), 'administrative features;', 18, 'provinces')
