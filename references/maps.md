# 地图视觉参考与制作要求

内置组件位于[`assets/history-map`](../assets/history-map/index.html)。核心是[`HistoryMap`](../assets/history-map/src/history-map.mjs)，直接接收Canvas与故事JSON，绘制真实地形、故事疆域、地点、旗帜、人物画像和路线，并由时间或帧号控制镜头。组件无前端运行依赖，地图数据已本地化。

## 运行与接入

人物与地图组合使用`StoryMapView.tsx`（普通React）或`RemotionStoryMap.tsx`（按帧）；传入scene、assets、characters、layout、theme，以及地图和人物资产的baseUrl。地图主导、单人讲述、双人对峙共享资产与数据，具体配置见[人物对峙地图](character-map.md#公共组件配置)。

可选布局参数：`autoFit:{featureIds:[历史几何ID],padding:{left,right,top,bottom}}`自动框住指定疆域（安全区按1920×1080逻辑像素）；启用时可省略camera，并覆盖手工camera。`zoom`默认1，可放大检查细节；主动放大可能裁出边界。`labelLayout`默认启用，避让旗帜与其它标签，拥挤时隐藏低优先级名称。地点可设`kind:"capital"`、`priority`、`maxSpan`（可见最大经度跨度）；默认都城全景可见、普通城市跨度≤50度才出现。区域可显式设maxSpan。避让采用确定性候选位置，不随播放累积；偏移的城市名称有引线。关闭labelLayout保留原始指定排版。渲染结果仍需检查旋转/竖排标签与复杂省区的阅读效果。

React宿主使用`assets/history-map/src/HistoryMapView.tsx`，传入`scene/baseUrl/time/width/height`；普通预览由页面时间驱动。Remotion使用同目录`RemotionHistoryMap.tsx`，以`useCurrentFrame()/fps`驱动并等待地图加载。内容与样式放scene，React组件不写具体朝代。场景或素材版本改变时以React key重建Remotion实例，不沿用旧加载句柄。

需要真实倾斜透视和地形起伏时，使用[公共3D地图组件](maps-3d.md)。2D与3D共享经纬度、地理数据来源和时期核查原则；朝代/战役地点、路线、区域均写入故事配置，不改公共组件源码。3D能力和当前限制见该文，不将二维CSS倾斜称为真实3D。

在skill目录执行：

```
node assets/history-map/tools/serve.mjs 8846
```

打开`http://127.0.0.1:8846/`。预览包含全局疆域、局部高亮、多势力对照和清朝1820省区四种场景，支持播放/暂停、拖动、编辑或导入故事JSON、保存1920×1080 PNG。清朝场景入口为`?scene=qing`，高清静帧入口为`frame.html?scene=qing&time=5`。

浏览器工程接入：

```js
import { HistoryMap } from './assets/history-map/src/history-map.mjs';
const map = new HistoryMap(canvas, scene, { width: 1920, height: 1080 });
await map.ready;
map.setTime(8);     // 秒
map.setFrame(240, 30); // 视频帧号与fps
```

将组件及`data/`复制到项目可访问的目录。打包器改变文件位置时，显式传`baseUrl`指向组件资产根URL；自有底图通过`scene.basemap`指定，格式见`data/basemap.json`。在HyperFrames/Remotion内用引擎当前时间/帧调用上述方法，等待`ready`完成后才能截图或继续渲染；不要运行演示页的requestAnimationFrame播放器作为视频时间源。

故事参数见[`demo-scenes.json`](../assets/history-map/data/demo-scenes.json)：

- `camera`：按时间递增的`{time, center:[经度,纬度], span}`关键帧，span为横向经度跨度。
- `boundaries`：GeoJSON URL或FeatureCollection对象；`regions`用`featureId`选几何，另给`name/color/label/start/end/fade`。也可直接传`geometry`，不受示例朝代限制。
- `subdivisions`：`{source:行政区GeoJSON URL, regions:[...]}`，省区独立于国家疆域加载和绘制；区域支持`labelCaption`建制副标题及`dash`虚线。清朝1820示例采用CHGIS十八省及省外行政地区，台湾归福建、海南归广东，新疆及东北将军辖区不标为省。
- `regions[].states`：`{time,featureId或geometry,name,color,label}`快照，到该时刻直接切换几何；`years:[{time,year}]`同步切换年代文字，不捏造过渡边界。
- `places`与`flags`：`coordinates`定位；flags支持竖排`name`、地点名`place`、颜色、高度、出现时间，以及避让文字的`dx/dy`偏移和引线。
- `portraits`：本地图片`src`、设计坐标`rect:[x,y,w,h]`、姓名、圆形裁切与出现时间；姓名可替换，无生成脸部需求。
- **内置边界年份覆盖（仅此五档，均为Cliopatria概化数据）**：公元前300、1200、1300、1600、1820。其它年份没有内置边界，须按下文“没有对应年份边界数据”的规则处理：只用地形与城市坐标，或提出有依据的重建方案供用户确认，不得拿相近年份顶替。1820另有CHGIS十八省区。
- 组件当前自带底图覆盖东亚，河流/海岸为现代地理参照；自带历史边界为Cliopatria概化数据，故事所需的精细疆域须替换或细化。地形、疆域及画像来源保存在`data/sources.json`。

清朝省区由`tools/prepare-qing.py --cache <缓存目录>`转换，转换环境需要pyshp、pyproj、shapely；支持在`<缓存目录>/python`安装转换依赖。CHGIS的Dataverse元数据列为CC0，但随附V6协议限制商业使用与数据再分发，不能据元数据将这套省界标为无条件商用。授权原文与处理记录见`data/sources.json`。

离线浏览器回归：`node assets/history-map/tools/verify.mjs <预览URL> <输出目录>`。检查三种场景、倒拖帧一致性、播放/暂停、JSON编辑和PNG导出；测试依赖本机Playwright与Chromium/Chrome/Edge。示例页不需要这些测试依赖。

## 三张参考图

- [全局疆域与人物](../assets/map-reference/01-overview.png)：浅蓝海洋、浅色陆地、可见地形起伏；大块灰色疆域、书法政权名；侧边独立人物立绘和竖排姓名。
- [局部势力高亮](../assets/map-reference/02-local-highlight.png)：灰色地形底图、亮蓝河流；青色区域与浅色细轮廓；城市点、地名和竖向旗帜相互关联。
- [多势力并列](../assets/map-reference/03-factions.png)：淡色地形、多色势力范围、深色细边界、区域内势力名称；地点上方立旗，配角落人物照片。

截图只作视觉参考，不作为疆域、人物所在位置或河道的史料。平台搜索框、水印、账号文字和视频介绍不属于成片设计。静态图不能确定原视频的镜头路径、旗帜运动或时长。

## 图层与样式

1. **地理底图**：采用真实坐标和地形晕渲；默认俯视，海洋浅蓝或浅青，陆地灰米色。保留山地起伏，降低现代道路、建筑和其它无关细节。隐藏现代省界、国界及自带地名。
2. **故事区域**：分别叠加当年国家疆域、政权控制区、行政区或事件范围。色块与轮廓独立，填色后仍能读出地形。单点叙事用灰底加一处高亮；多方对峙用能分辨的柔和颜色，同一势力跨镜保持颜色。
3. **水系与地点**：蓝色河流、城市圆点和故事地名。现代水系可作地理参照；剧情依赖古代河道时另核查，不把现代河道当成当年事实。
4. **文字与旗帜**：区域内放政权或势力名称，重要地点旁放清晰地名。竖排旗帜含人物或势力名称，通过旗杆/连线锚定地点。大字可用书法风格，小地名优先可读字体；缩放时保持合理字号及描边，防止遮住关键区域。
5. **人物素材**：照片、史料画像或符合本技能人物限制的素材作为独立前景层。可用侧边半身构图、圆形头像和竖排姓名，按信息需要显示，不覆盖关键边界和地点。
6. **视频叠层**：时间、段落标题和字幕与地图分开；预留字幕安全区。无需把截图中的所有标题、旗帜和人物塞进每个镜头。

地图组件复用地理投影、绘制逻辑、样式和时间控制；每个故事提供独立地名、坐标、区域几何、有效年代、事件时间和来源记录。疆域多边形、地点与底图必须使用同一坐标基准。

## 历史区域要求

- 按故事年份绘制国家、政权、行政区及其名称；同一地点在不同年代可以有不同名称或归属。
- 历史区域允许跨越今天的省界，或把今天一个省的范围划入多个政权。不得把整块现代省份重新着色、改名当作古代疆域。
- 区分国家疆域、实际控制范围、起义活动范围、进军路线和事件示意范围。示意范围有明确含义，不用它冒充已核实的控制边界。
- 疆域变化使用各时点有依据的几何数据；复杂兼并不默认作线性形状变换，以免制造不存在的中间边界。资料不足时采用有依据的概化表达并标明示意。
- 地名位置按历史地点核查，不能假定古城址等于同名现代城市中心。人物旗帜表示什么地点或事件，也须有文案依据。
- 数据来源、年份、精度与授权写入工程记录。样式好看不等于边界准确；全球粗粒度历史数据不能直接用于局部战役特写。

## 动画与验收

可按讲述需要从全局地图推近地点、逐步显示旗帜、推进路线、改变高亮或切换疆域快照。运动由视频当前时间/帧计算，暂停、倒放定位和导出时应得到相同状态；素材和地理图层加载完毕后才捕获帧。

默认先做俯视地形晕渲效果；有明确叙事需要时再用倾斜3D地形。地图、疆域、河流和地点随同一个镜头变换；人物卡与字幕可留在屏幕上。避免图层漂移、文字碰撞、旗帜遮挡和缩放后的锯齿。

画面方案先交付全局、局部高亮、多势力对照的代表帧，按主题选实际需要的类型；运动样片检验镜头定位、图层对齐与文字稳定。视觉参考已经确定，无需重新询问是否采用这种风格；具体故事的史料和代表帧仍按原制作流程验收。
