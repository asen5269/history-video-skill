# 豆包配音规范

默认使用V3双向WebSocket；2026-10-25用户指定默认音色为霸气青叔2.0、1.1倍速。2026-10-14曾用刘飞2.0验证接口可用，该历史验证不代表当前音色。音色与语速保持用户设置。

## 请求

- WSS `wss://openspeech.bytedance.com/api/v3/tts/bidirection`，依赖Python和`websockets>=15`；安装：`python -m pip install "websockets>=15"`。
- 新鉴权：`X-Api-Key`读取`DOUBAO_TTS_API_KEY`；`X-Api-Resource-Id: seed-tts-2.0`。不存在新版Key时可用旧`APPID/TOKEN`，按[旧鉴权官方说明](https://docs.volcengine.com/docs/6561/2534847?lang=zh)发送`X-Api-App-Id`、`X-Api-Access-Key`与随机请求ID；不要把新版Key填到旧TOKEN字段。
- 音色霸气青叔2.0：`zh_male_baqiqingshu_uranus_bigtts`（[官方音色表](https://docs.volcengine.com/docs/DoubaoVoice/Tonelist-1?lang=zh)），不可使用旧小模型`BV107_streaming`代替；`audio_params.speech_rate: 10`对应原1.1倍速；MP3、24000Hz、160000bps、`enable_subtitle: true`。`tts-v3.py`从`item.spec`读取音色、语速与编码，保证实际请求与`audio-cache.mjs`一致。
- 二进制协议实现见`scripts/tts-v3.py`，依据用户提供的官方协议附件。建立连接→等待ConnectionStarted→StartSession→等待SessionStarted→TaskRequest→FinishSession→收音频与字幕直到SessionFinished；之后才允许下一句复用同一连接，最后FinishConnection。不能把这些事件当普通JSON WebSocket消息。
- 收齐音频且SessionFinished后写MP3与hash元数据；服务拒绝、空音频、消息截断或超时则报错停止，不自动切换协议重复计费。接口升级不重置账户额度。
- `node scripts/tts.mjs <项目>`默认V3。旧有效缓存仍可复用；`--ids s001`或`--force`按当前协议重合成。需旧HTTP时显式`--protocol v1`或`HV_TTS_PROTOCOL=v1`。
- 旧HTTP仍使用系统curl：POST `/api/v1/tts`，`Authorization: Bearer;TOKEN`，`cluster: volcano_tts`、`speed_ratio: 1.1`、`operation: query`，成功`code:3000`返回base64。用户代理曾截断Python urllib响应，此限制针对旧HTTP，不阻止已实测的WebSocket客户端。

## 凭据

放在项目目录或其上级的`.env`/`key.env`，脚本逐级向上查找并自动读取；已设置的环境变量优先。

```
DOUBAO_TTS_API_KEY=...
# 只有继续使用旧版控制台时才配置下面两项：
# DOUBAO_TTS_APPID=...
# DOUBAO_TTS_TOKEN=...
HV_IMAGE_BASE_URL=...
HV_IMAGE_API_KEY=...
```

- 凭据文件只放在工作目录，绝不放进skill目录；项目用git时把`.env`写进`.gitignore`。
- 只检查键是否存在，不读出、不打印值，不复制到`project.json`、日志或其它文件。
- 缺少时告诉用户在项目`.env`中补哪个键，不让用户贴进聊天；期间暂停相关请求，不伪造调用成功。

凭据绝不打印，除`.env`外不写入任何文件、工程、日志或记忆。请求体包含敏感字段时通过内存stdin送给curl，避免临时请求文件。认证头避免落入持久化脚本、日志或命令转录；可用curl从stdin读取内存配置。禁用包含认证信息的verbose/trace输出。只报告脱敏状态码与错误摘要。

响应优先留在内存；若调用需要临时响应JSON，解码MP3后立刻删除，失败时也清理。响应内容不发送到工具输出。

## 合成与校验

### 讲话节奏与参考声线

学习参考视频的停顿、轻重和解释顺序，不据转写稿推断其具体音色、情绪或音乐；未实际听过就注明文本分析。默认音色与语速保持用户设置，不因参考视频自动换音色、克隆声音或整体加速。

逐句合成容易让相邻句子都重新起调。试片要连续试听：指代与话题是否接得上，补充说明是否像另起一段，每句是否都在强调。先修措辞、标点和有依据的停顿，再重做有问题的句子；不要为掩盖断裂把整片无差别加速。接口不支持的情绪、重音和连续合成控制不能写成已经实现。

引文前后、数字比较处、结果揭示处可有不同轻重；不逐字加重、不每句拖尾。BGM服务整段情绪与转折，避免跟随每个反问起伏；争议材料出现时不靠惊悚音效预先替观众判案。

脚本实现见`scripts/tts.mjs`、`trim.mjs`、`timeline.mjs`、`gate.mjs`。以下为其规则，改脚本时保持一致。

1. 稿子及画面方案确认后逐句合成，一句一个MP3，编号与文案句子ID对应。默认按文本、音色配置及音频hash复用；`-Ids`强制重做已有句子。
2. 显示文案与TTS文本分开保存。年份送入TTS前改成汉字，如1449年→一四四九年。多音字读错，用同音字或适当读音提示修改TTS文本；字幕保留原字。
3. 用FFmpeg的`silenceremove`结合`areverse`，分别去掉首尾静音。不使用`start_duration`或`stop_duration`参数。注意不要截掉低音量首尾字。
4. 用ffprobe读取处理后的句子时长。结合字数、正常语速和试听识别异常偏短、缺字或截断；仅重做异常句子，不用统一固定阈值误判短句。
5. 句后停顿`pause`可写数字（0.3–1.5秒）或档位：`beat`0.35（默认句间）、`turn`0.6（转折）、`breath`1.0（段落、钩子之后、反转之前）、`hold`1.5（重大落点）。转折停顿替代该位置普通句间停顿，避免无意叠加。超过0.6秒的停顿须写`pauseWhy`说明叙事理由，不为凑时长加停顿。长稿（≥20句）80%以上停顿相同时gate警告节奏单一。
6. 结尾留白用`script.tail`（秒，默认2，上限5），加在最后一句之后，画面与配音同步停留，用于读懂结尾提问。
7. 固定句子音频与停顿后建立完整配音时间轴。

## 字幕

新版`enable_subtitle`支持原生字级时间戳；脚本保存为`audio/raw/<id>.mp3.subtitles.json`，含实际TTS文本、原始音频hash、TTSSubtitle事件及usage。它基于未裁剪音频，不能直接冒充裁剪WAV的对齐结果。当前仍用whisperX完成裁剪后逐字对齐；以后接入原生时间须先验证漏字、专名映射与首部裁剪偏移，不能按字数平均分配时间兜底。

对每句裁剪后的WAV从0开始对齐，缓存句内相对时间；导出字幕时读取当前timeline，加上句子起点，不缓存旧全片偏移。TTS同音字替换与原文建立对应关系，字幕恢复原字；年份也保留原稿显示形式。断句依据口播节奏，检查专名、重叠、负时长、漏句以及偏移。保留字级结果用于局部更新，SRT按可读字幕块导出。字符缺失或时间不完整时失败，不能用平均时间或最后一字兜底。

对齐工具固定为whisperX的wav2vec2对齐（`scripts/align.py`，显式指定模型`jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn`），只对齐不转写；安装`pip install whisperx`，首次运行下载模型及必要分词资源。缓存有效且没有指定重做时跳过推理；`--ids s001,s002`强制重做指定句，`--force`重做全部或所选句子。字幕块由`scripts/srt.mjs`生成。缺少依赖时在制作前说明并解决；不要把ASR粗略时间戳替代为已验证的逐字对齐。
