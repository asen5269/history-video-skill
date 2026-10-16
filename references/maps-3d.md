# 公共3D地图组件

公共源码：`assets/history-map/src/history-map-3d.mjs`、`story-3d.mjs`。渲染器与朝代/战役数据分离；不可将具体地点、人物、路线或某一时期边界写进公共渲染源码。Three.js由调用工程注入，公共组件不绑定Remotion或React。

## 接入

将两个模块复制到工程源码目录，安装工程需要的 `three`。故事JSON和地理数据放可访问的资产目录。

```js
import * as THREE from 'three';
import {createHistoryMap3D} from './history-map-3d.mjs';
const map = await createHistoryMap3D(canvas, story, {
  THREE, baseUrl: 'http://localhost:8860/public/', width: 1920, height: 1080
});
const labels = map.setFrame(frame, fps); // 或setTime(seconds)
// labels含地点数据、visible和投影后的x/y，由宿主排版姓名/时间/地名。
// 宿主卸载时按实际渲染生命周期调用map.dispose()。
```

Remotion等待异步加载完成再continueRender；每帧调用setFrame，字幕与标签由宿主排版。不要使用独立requestAnimationFrame循环。二维HistoryMap继续独立可用，不将2D默认样式强制套给3D。

## story配置

```json
{
  "id": "topic-id", "duration": 10,
  "terrain": "terrain.json", "land": "land.geojson", "rivers": "rivers.geojson",
  "verticalExaggeration": 12, "worldWidth": 160,
  "style": {"land":"#526453","sea":"#082b3c","river":"#5d9daf"},
  "camera": [
    {"time":0,"position":[18,98,112],"target":[0,0,-4]},
    {"time":10,"position":[-2,90,120],"target":[0,0,-4]}
  ],
  "places": [], "routes": [], "regions": []
}
```

- 经纬度统一WGS84 `[经度,纬度]`，与地形使用同一Web Mercator投影。地点：`{id,name,caption,coordinates,start,end}`。
- 路线：`{id,coordinates:[[经度,纬度],...],meaning,color,start,end,duration}`。含义和史料依据在工程记录；给足沿途采样点，当前按顶点顺序揭示，不是按距离匀速行进。不能用城市间直线冒充实际行军路线。
- 区域：`{id,geometry,year,source,color,start,end}`。geometry支持Polygon/MultiPolygon（含孔）；当前显示贴地轮廓，不支持区域实体填充。疆域变化用不同几何的start/end切换，不捏造中间边界。控制区、战场示意区与行政区在来源记录中区分。
- camera位置/目标使用地形模型坐标，不是经纬度：地形东西宽为worldWidth，中心为原点，+X向东、+Z向南、+Y向上；可先用terrainPoint3D转换地理目标。未来镜头编辑器可输出同一接口，不改变故事坐标格式。
- style负责外观，story负责历史内容；标签由宿主提供统一样式。宽高由调用者设置。

## 地形资产与覆盖

```text
python assets/history-map/tools/prepare-terrain3d.py --bounds 112 34 130 46 --zoom 5 --grid 241 201 --cache <缓存> --out <工程>/public/terrain.json
```

需要Pillow。bounds为西、南、东、北；适用于不同区域，不限定清朝或东北。跨日期变更线须拆分区域。zoom和网格按用途选择：广域朝代概览与局部战役采用不同覆盖和精度，放大粗网格不会变成精细战场。下载和缓存是制作前步骤，逐帧渲染不联网取瓦片。

高程文件包含width/height/extent/elevations（米），来源记录与许可署名单独保留。默认高度不夸张，story可显式调整并注明。数据范围不足时组件报错，先准备正确区域DEM，不把越界地点吸附到边缘。当前不支持全球球面、自动分块LOD或历史地形复原。

“能绘制任意朝代/战役的数据”不等于“自带全部历史疆域与战场资料”。内置历史边界覆盖公元前300、1200、1300、1600、1820五个年份；其它时期需有依据的外部几何。基础地理数据按原地图规范准备，缺历史边界时只显示地形、地点和有依据的路线。

## 验证

`node --test assets/history-map/tools/story-3d.test.mjs`检查投影、高程采样、越界和倒拖帧。工程必须再实际渲染关键帧与短MP4，检查地理位置、遮挡、轮廓贴地和纹理稳定；结构通过不证明历史准确。
