# 工程数据格式

工程目录 `<项目>/`，所有脚本以它为参数。业务JSON只放数据与素材记录；凭据放工作目录的`.env`/`key.env`或进程环境变量，不进入业务JSON。

## project.json

```jsonc
{
  "topic": "土木堡之变",
  "mode": "single",               // single | series
  "episode": 1,
  "stage": "script",              // script | plan | trial | preview | export | cover | done
  "confirmed": {                  // 只写用户实际确认的版本号
    "script": null, "title": null, "hook": null,
    "plan": null, "trial": null, "export": null
  },
  "title": null,
  "engine": "remotion",           // 新工程默认remotion；兼容旧hyperframes；mixed主合成为Remotion
  "durationMinutes": { "min": 10, "max": 20 }, // 目标范围；超出只警告不阻断。用户改时长时更新
  "fps": 30, "width": 1920, "height": 1080,     // 可省，默认如左；镜头总时长门与export门按它们核对。engine为hyperframes/mixed时fps只能24/30/60
  "preview": null,                // 本地URL
  "notes": []                     // 用户偏好、返工记录
}
```

改稿后递增`script.version`，把`confirmed.script`、`confirmed.hook`及受影响的方案、试片、导出确认置回null，并在notes写明原因。确认值是用户实际批准的版本号，不是布尔值。文案审稿门不要求已确认；plan、voice、subs门检查`confirmed.script === script.version`和`confirmed.hook === script.version`（钩子随稿子一并审核时两者同时写入）；subs门另检查`confirmed.plan === shots.version`。

`export`门（`gate.mjs <项目> --stage export`）在编码出`output.mp4`之后运行：要求`confirmed.export`已写入，并用ffprobe核对画幅、帧率、视频与音轨时长（视频误差≤2帧、音轨≤0.1秒）、音轨存在，且字幕不超出视频时长。

`cover`门（`gate.mjs <项目> --stage cover`）在生成封面前运行：要求`confirmed.export`已写入，且`project.title`非空并等于`confirmed.title`（标题是字符串，因为标题随用户修改而不是随稿子版本）。`trial`确认目前没有脚本检查。

本文带注释的JSON示例用于说明；实际文件必须为合法JSON，去掉注释。

## script.json

```jsonc
{
  "version": 3,
  "titles": ["…", "…", "…"],
  "hooks": [{ "text": "…", "evidence": "《明史·英宗本纪》…" }],
  "hookSentences": 1,             // 钩子占前几句，gate 检查≤5秒
  "sentences": [
    { "id": "s001", "text": "1449年…", "tts": "一四四九年…", "fact": true, "pause": 0.5 }
  ],
  "evidence": [
    { "ids": ["s001"], "claim": "…", "source": "《明史》卷十", "edition": "中华书局点校本",
      "locator": "本纪第十 英宗前纪 正统十四年八月", "url": "…", "status": "verified",
      "snapshot": "sources/mingshi-10.txt", "quote": "八月…车驾至土木" }
  ]
}
```

- 每条证据须带`snapshot`（工程目录内的原文快照相对路径，抓取到的实际文本）和`quote`（原文摘录，≥8字）。gate检查摘录能在快照中检索到（比较时忽略空白并做NFKC规范化，不忽略标点和异体字）。这只证明"摘录确实来自所存文本"，不证明快照来自正确版本、摘录支持该论断，二者仍需人工判断。快照放`sources/`，只存核查所需段落，注意版权与体积。

- `id`以英文字母开头，只含字母、数字、下划线和短横线；不随局部修改重新编号。
- `tts`省略则用`text`。替换后字数不等时给`map: [[显示起, 显示止, tts起, tts止]]`；两端均按非标点字符、从0开始、左闭右开计数。map按顺序列出改变长度的区间，其余文字一一对应。例如显示`甲，21年，乙？`、TTS`甲，二十一年，乙？`，map为`[[1,3,1,4]]`。缺map、越界或重叠会失败，不借用最后一个字符时间补齐。
- 每句显式填写`fact: true/false`，不能用缺省字段绕过事实证据检查。`fact: false`的句子若含数字、年份或数量，gate给警告提示复核（评论句也可能夹带事实）。
- 语速异常句试听无误后，在该句写`"speedOk": "说明"`放行，否则语速门一直失败。
- `fact: true` 的句子必须被某条 `evidence.ids` 覆盖；`status` 为 verified 才能交稿。
- `pause` 为该句后的停顿：数字（0.3–1.5秒）或档位`beat`/`turn`/`breath`/`hold`（0.35/0.6/1.0/1.5），省略为`beat`。>0.6秒须写`pauseWhy`。
- `script.tail`为最后一句之后的结尾留白秒数，默认2，上限5；计入`timeline.total`，镜头总时长须覆盖。旧工程升级后须重跑timeline再跑gate。

## shots.json

```jsonc
{ "version": 1, "scriptVersion": 3, "shots": [
  { "id": "c01", "sids": ["s001","s002"], "dur": 6.2, "size": "wide",   // wide | medium | close
    "recipe": "crane-reveal", "layers": ["fg:城垛虚化", "mid:明军旗阵剪影", "bg:暮色远山", "fx:尘埃光"],
    "landing": "s002「土木堡」出字时停在旗杆", "engine": "remotion", "render": "todo" }
]}
```

`version`为画面方案版本，`scriptVersion`指向当前稿子；重审方案时更新。`dur`是镜头的逻辑时长（切点），逐镜相加必须等于配音总时长；转场需要的渲染余量写在可选字段`overlap`（秒，0–2，向后伸入下一镜，不计入`dur`，末镜为0，且不得超过下一镜`dur`）。`recipe`取值与规则见[镜头运动](motion.md)。`parallax-dolly`至少3层；其它镜头按实际需要分层。`detail-hunt`和`evidence-hold`至少1层并给`overlay`。每镜须有正时长、合法景别、关联句子和落点/静止目的，方案覆盖全文；完整检查时镜头总时长与真实配音误差不超过1帧（30fps）。

## 视觉制作字段

出现人物立绘时另建工程`characters.json`，记录`scriptVersion`、角色稳定ID、关联句子/镜头、时期身份、外观与服饰依据、艺术选择及版本化变体。角色变体映射到`assets.json`中的真实立绘；公共组件只消费解析后的资产与场景配置。格式与从故事生成的步骤见[角色资产流程](character-map.md#从故事生成角色资产)。新增记录目前由执行者维护与人工验收，不是已有自动角色生成器或gate检查项。

`shots.json` 每镜补充 `textAnchor`（对应台词）、`visualAction`（可见动作或阅读细节）、`assetIds`（素材ID数组），以及：

- `visualRole`：现场 / 证据 / 空间 / 关系 / 情绪。
- `stateChange`：起始状态→动作/揭示→结束状态；静止镜写阅读对象。
- `continuity`：相邻镜的空间、方向、光线、形状关系或跳跃目的。
- `assetMethod`：史料原图 / 完整场景 / 场景拆层 / 解释动画 / 视频素材。
- `reuseReason`：重复使用素材时新增的信息或呼应目的，适用条件见制作规范。

工程 `visual-direction.md` 保存风格参考、构图/光线约束与成本估计；`visual-review.md` 保存实际观看、复用统计、缺陷截图与修正。示意场景的性质与依据写入对应素材来源记录。上述新增字段由人工核对，现有gate不验证其语义；旧工程在修改对应镜头时补齐。详细决策见[视觉导演](visual-direction.md)。

## 缓存与版本

- 配音旁的`<id>.mp3.json`记录实际TTS文本、音色、语速、编码及音频SHA256。旧HTTP缓存带`cluster`；新WebSocket缓存带`protocol: "v3"`、`resourceId`、`sampleRate`、`bitRate`、`speechRate`和`enableSubtitle`。两种有效缓存均可复用；换协议不自动重做已有匹配音频。`tts.mjs <项目> --ids s001,s002`或`--force`按当前协议强制重做。
- 新版旁存`<id>.mp3.subtitles.json`：`timebase: "raw-sentence"`、实际TTS文本、原始音频SHA256、`TTSSubtitle`原生事件及usage。原生时间基于未裁剪音频，不能直接写入基于裁剪WAV的`align.json`；当前字幕流水线仍用whisperX逐字对齐，不以未校验的原生时间兜底。
- `durations.json`格式为`{ "version": <稿子版本>, "items": { "s001": { "duration": 2.35, "tts": "…", "rawHash": "…", "audioHash": "…", "threshold": "-50dB" } } }`。裁剪缓存另存`<id>.wav.json`，改阈值或原始音频后自动重裁剪。
- `timeline.json`含稿子版本、实测总时长、`voiceHash`及逐句`id/start/end/pause/tts/audioHash`。配音以48kHz采样位置拼接；`--no-audio`仅生成时间轴，不能通过配音质量门。
- `align.json`格式为`{ "schema": 2, "timebase": "sentence", "items": { "s001": { "tts": "…", "audioHash": "…", "model": "…", "chars": [{ "c": "甲", "s": 0.05, "e": 0.2 }] } } }`。字级时间相对于该句WAV，不含全片偏移。文本/音频/模型一致才复用；`--ids`强制重对齐指定句，范围外有失效缓存就报错。
- 改台词后重跑tts→trim→timeline→align→srt；只改停顿也重跑trim、timeline、srt，以刷新版本和全片偏移，未变的句内对齐可复用。更新镜头时长后再跑完整gate。
- 旧缓存缺少文本/音频指纹，或旧align使用绝对时间时，不自动信任。原文件保留，可从已知调用记录补齐真实元数据并核对hash；没有可靠记录就重合成。旧align须全量重对齐一次，之后支持局部重用。不得仅为过门伪造元数据。

## mix.json 与 assets.json（BGM）

```jsonc
// mix.json
{
  "bgm": { "file": "assets/bgm/theme.mp3",   // 工程内相对路径
           "gainDb": -18, "fadeIn": 2, "fadeOut": 3, "loopCrossfade": 2 },  // 后四项可省，数值为默认
  "sfx": [ { "type": "whoosh", "at": 12.4, "gainDb": -10 } ]    // type: whoosh|impact|ping|drum；at为全片秒；gainDb可省
}
// assets.json（数组；BGM一条）
[ { "type": "bgm", "file": "assets/bgm/theme.mp3", "title": "…", "source": "Pixabay Music",
    "license": "CC BY 4.0", "licenseUrl": "https://…", "retrieved": "2026-05-01", "attribution": "曲名 by 作者" } ]
```

- `mix.mjs`：BGM不足时用`acrossfade`首尾交叉淡化循环铺满，按`timeline.total`裁切并淡入淡出；以`voice.wav`为侧链对BGM闪避（门限0.02、比8、attack 30ms、release 500ms）；音效是固定参数的程序合成，只作点状事件；最后两遍`loudnorm`归一到-16 LUFS、真峰值≤-1.5 dBTP，输出48kHz立体声`mix.wav`，时长严格等于配音总时长。
- `gate --stage mix`检查：配置合法；稿子、配音与混音版本一致；`mix.json`或BGM文件未变；`mix.wav`存在、哈希匹配、时长误差≤2ms；积分响度-16±1.5 LU、真峰值≤-1.0 dBTP；BGM在`assets.json`登记了来源、授权页链接、取用日期，CC BY类授权须填`attribution`。
- 门禁只证明技术指标和授权**登记**齐全；授权页内容是否真的允许本用途、BGM是否好听、与内容情绪是否匹配、人声是否清晰可懂，仍需人工试听。
- 平台通常会再做自己的响度处理；-16 LUFS是保守的短视频目标，不代表某平台的具体规范。

## 生成物

| 文件 | 来源 |
|---|---|
| `audio/raw/<id>.mp3`及`.mp3.json` | tts.mjs |
| `audio/trim/<id>.wav`及`.wav.json`、`durations.json` | trim.mjs |
| `timeline.json`、`voice.wav` | timeline.mjs |
| `align.json` | align.py |
| `subs.json`、`subs.meta.json`、`output.srt` | srt.mjs；meta记录稿子版本及字幕块长度参数 |
| `mix.wav`、`mix.meta.json`、`audio/sfx/` | mix.mjs；meta记录配音/配置指纹与实测响度 |
| `shots.json` | 画面方案：镜头ID、对应句子ID、景别、动作、素材、引擎、渲染状态 |
| `assets.json` | 素材来源：名称、机构、年代、URL、授权、取用日期、镜头ID；BGM同表 |
