---
name: history-video
description: 制作中文历史解说视频，适用于朝代、帝王、人物和历史故事；从史料核查与解说稿，经画面方案和30秒试片，到HyperFrames或Remotion完整预览及确认后导出。支持按时间段局部修改。配音、时间轴、强制对齐、字幕与质量门由脚本确定性完成。Use when asked to 做历史视频、历史解说、讲某朝代/皇帝/人物/战役、history explainer video。
---

# 历史视频解说

## 用户默认设置

- 解说：用大白话讲故事，理解门槛以十岁孩子为准；不使用哄孩子、上课或主持人提问的口吻。写稿及修改必读[研究规范·解说文风与口播验收](references/research.md#解说文风)。幽默随具体事件自然发生，史实与评论分开，史料严谨为硬性要求。
- 画面和结尾不显示来源；来源只留在工程文件。
- 平台：抖音、视频号。开场钩子与结尾提问规则见研究规范。
- 标题：随稿给3–5个候选，用户确认最终标题。
- 时长目标10–20分钟，不注水不硬压；超出范围gate只警告，不阻断；分集每集同范围。画幅16:9 1920×1080，默认30fps。
- 视觉：地图讲解＋插图辅助。全片以真实地图为持续背景，围绕地点、路线、势力变化及事件落点组织讲述；人物关系等段落在地图上叠加关系图。插图只补充人物、建筑、军队或道具，不生成场景背景。具体要求见[制作规范](references/production.md#默认视觉地图讲解插图辅助)和研究规范，审美检查未过先返工。
- 地图：复用内置[HistoryMap组件](assets/history-map/src/history-map.mjs)，参数与预览启动见[地图组件接入](references/maps.md)。内置边界仅覆盖公元前300、1200、1300、1820四个年份，其它朝代需自备有依据的几何，否则只用地形与地点。采用地形晕渲、故事疆域与地名旗帜，隐藏现代行政边界和默认地名。
- 引擎：HyperFrames、Remotion为主，按镜头选择。不用剪映等剪辑软件。FFmpeg处理音频与编码。
- 配音：豆包TTS刘飞2.0，语速1.1，见[配音规范](references/voice.md)。
- BGM网上检索并记录授权；音效仅程序合成。
- 完整视频先本地网页预览；确认导出后交付MP4＋SRT，工程与缓存保留。
- 封面：成片确认后按最终标题生成3:4和4:3两张。

## 开始时

用户输入主题即可，如“明代所有皇帝”“王安石”“土木堡之变”。涉及地图的主题先对照内置边界年份，缺数据时在画面方案阶段说明。

默认做一条；主题内容明显超过20分钟时，提出分集建议并询问。其它偏好沿用，缺信息时一次只问一个问题。

先读工程目录的`project.json`（格式见[工程数据](references/project.md)），从`stage`继续。查看进度或改一处不等于重做整片。

## 流程与确认节点

1. **查资料、写稿**：按研究规范核查，写入`script.json`（句子、TTS文本、证据、钩子候选、标题候选）。先完成研究规范中的口播人工验收，再运行`node scripts/gate.mjs <项目> --stage script`；结构门通过不能代替口播验收。完成后交付正文、标题候选、钩子候选、简短来源说明、预计时长。稿子确认不代表标题确认；开场钩子随稿一并审核，确认时同时写入`confirmed.script`与`confirmed.hook`。
2. **画面方案**：先读[镜头运动](references/motion.md)。逐镜写入`shots.json`（配方、分层、景别、落点），运行`gate.mjs --stage plan`全过；交付美术设定、三张代表性静帧和一段3秒运动样片。展示后等待确认，再批量生图、配音、渲染。
3. **30秒试片**：选代表性连续片段（优先含开场钩子），完成真实配音、画面、字幕、音乐与音效，标明原稿片段。等待确认。
4. **完整预览**：可播放/暂停/拖动的本地页面，音画字幕同步。按用户指出的时间段修改。
5. **导出**：仅在用户明确确认导出后编码MP4＋SRT。方案、流程同意或试片通过都不等于导出授权；用户另定新规则时从其规则。
导出编码后运行`node scripts/gate.mjs <项目> --stage export`核对成片规格。
6. **封面**：成片确认后生成；标题未定先让用户选。生成前运行`node scripts/gate.mjs <项目> --stage cover`，要求导出与最终标题均已确认。

需要确认时展示成果并停住，不提前执行下一阶段。每次确认写入`project.json.confirmed`。

## 配音与字幕流水线

稿子与画面方案均确认后，在skill目录下依次运行（`<项目>`为工程目录）：

```
node scripts/tts.mjs <项目>                                  # 内容、音色配置及音频hash均匹配才复用；--ids强制重做指定句
node scripts/trim.mjs <项目>                                 # 去首尾静音，写 durations.json
node scripts/timeline.mjs <项目>                             # timeline.json + voice.wav
node scripts/gate.mjs <项目> --stage voice                   # 时长、钩子≤5秒、语速异常
node scripts/mix.mjs <项目>                                  # 读mix.json：BGM循环+人声闪避+合成音效→mix.wav（-16 LUFS）
node scripts/gate.mjs <项目> --stage mix                     # 时长、响度、真峰值、BGM授权登记
python scripts/align.py <项目>                               # whisperX wav2vec2 中文逐字对齐（macOS/Linux通常用python3）
node scripts/srt.mjs <项目>                                  # subs.json + output.srt
node scripts/gate.mjs <项目>                                 # 默认subs：检查稿子、配音、镜头、对齐、字幕及SRT
```

gate失败先修再交付，不跳过。语速异常句试听后用`tts.mjs <项目> --ids s001,s002`重做，再从trim往下重跑；align可用`--ids s001,s002`只重对齐改动句。对齐缓存保存句内相对时间，srt按当前时间轴计算全片偏移。旧缓存迁移与版本规则见[工程数据](references/project.md#缓存与版本)。

维护脚本后运行`node --test scripts/test.mjs`。回归使用真实FFmpeg、TTS函数替身和本机生图测试服务，不调用付费接口。质量门只验证结构、依赖和时间一致性；史实、图像时代准确性和审美仍需人工检查。

## 执行与维护

制作、混音、预览和增量修改读制作规范。AI生图统一调用`scripts/imagegen.mjs`，配置与分层出图规则见[生图接口](references/imagegen.md)。使用HyperFrames/Remotion前读对应已安装技能，核实接口与环境；没打通的能力不声称可用。

首次使用或换机器先运行`node scripts/doctor.mjs <项目>`自检环境与凭据（只报键是否存在）。全部脚本为Node/Python，Windows与macOS/Linux通用；HTTP请求经系统curl发出（Windows为curl.exe，其它系统为curl，可用`HV_CURL`覆盖）。缺工具或凭据时只暂停相关步骤，继续其余工作并说明缺什么。禁止用占位音频、假地图或残缺预览冒充成果。凭据只放工作目录的`.env`/`key.env`或进程环境变量（见配音规范），禁止写入工程JSON和日志。最终回复简洁，给出预览/成片链接和待确认事项。
