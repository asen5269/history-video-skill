import argparse,json,math,pathlib,urllib.request
from PIL import Image
p=argparse.ArgumentParser(description='按经纬度范围准备可复用Terrarium高程网格')
p.add_argument('--bounds',nargs=4,type=float,required=True,metavar=('WEST','SOUTH','EAST','NORTH'))
p.add_argument('--out',required=True)
p.add_argument('--cache',required=True)
p.add_argument('--zoom',type=int,default=5)
p.add_argument('--grid',nargs=2,type=int,default=[241,201])
a=p.parse_args();west,south,east,north=a.bounds
if not(-180<=west<east<=180 and -85<south<north<85):p.error('bounds必须有效，跨日期变更线区域需拆分')
if not(0<=a.zoom<=12) or min(a.grid)<2:p.error('zoom或grid无效')
cache=pathlib.Path(a.cache);cache.mkdir(parents=True,exist_ok=True)
def mx(lon):return (lon+180)/360
def my(lat):return (1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2
extent=[mx(west),my(north),mx(east),my(south)];n=2**a.zoom;tiles={}
def tile(x,y):
 if (x,y) not in tiles:
  f=cache/f'{a.zoom}-{x}-{y}.png'
  if not f.exists():urllib.request.urlretrieve(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{a.zoom}/{x}/{y}.png',f)
  tiles[x,y]=Image.open(f).convert('RGB')
 return tiles[x,y]
w,h=a.grid;values=[]
for j in range(h):
 for i in range(w):
  u=extent[0]+(extent[2]-extent[0])*i/(w-1);v=extent[1]+(extent[3]-extent[1])*j/(h-1);tx,ty=u*n,v*n
  r,g,b=tile(min(n-1,int(tx)),min(n-1,int(ty))).getpixel((min(255,int(tx%1*256)),min(255,int(ty%1*256))))
  values.append(round(max(0,r*256+g+b/256-32768),1))
out=pathlib.Path(a.out);out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps({'width':w,'height':h,'extent':extent,'elevations':values,'source':'Mapzen Terrain Tiles / USGS / NOAA','bounds':a.bounds,'zoom':a.zoom},separators=(',',':')),encoding='utf-8')
print(f'{out}: {w}x{h}, elevations {min(values)}..{max(values)}m')
