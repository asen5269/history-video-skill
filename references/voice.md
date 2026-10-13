# 豆包配音规范

以下为用户已验证的调用约定。不要擅自换接口、音色、认证格式或网络客户端。

## 请求

- POST `https://openspeech.bytedance.com/api/v1/tts`。
- 必须通过系统curl调用（Windows为`curl.exe`，其它系统为`curl`，`scripts/env.mjs`自动选择）；不能用Python urllib，用户环境的代理会截断响应。改用Node `fetch`等其它客户端前，须在用户的真实代理环境验证响应完整。
- 请求头`Authorization: Bearer;${TOKEN}`：分号，没有空格。
- 音色`zh_male_liufei_uranus_bigtts`，`speed_ratio: 1.1`。
- 请求体`app.cluster: volcano_tts`，`request.operation: query`，每次请求`request.reqid`使用新UUID，`audio.encoding: mp3`。
- 成功响应`code: 3000`；`data`是base64编码的MP3。
- 完整请求字段依据已打通的本地调用代码或官方文档核验；不要猜测其余必填项。

## 凭据

放在项目目录或其上级的`.env`/`key.env`，脚本逐级向上查找并自动读取；已设置的环境变量优先。

```
DOUBAO_TTS_APPID=...
DOUBAO_TTS_TOKEN=...
HV_IMAGE_BASE_URL=...
HV_IMAGE_API_KEY=...
```

- 凭据文件只放在工作目录，绝不放进skill目录；项目用git时把`.env`写进`.gitignore`。
- 只检查键是否存在，不读出、不打印值，不复制到`project.json`、日志或其它文件。
- 缺少时告诉用户在项目`.env`中补哪个键，不让用户贴进聊天；期间暂停相关请求，不伪造调用成功。

凭据绝不打印，除`.env`外不写入任何文件、工程、日志或记忆。请求体包含敏感字段时通过内存stdin送给curl，避免临时请求文件。认证头避免落入持久化脚本、日志或命令转录；可用curl从stdin读取内存配置。禁用包含认证信息的verbose/trace输出。只报告脱敏状态码与错误摘要。

响应优先留在内存；若调用需要临时响应JSON，解码MP3后立刻删除，失败时也清理。响应内容不发送到工具输出。

## 合成与校验

脚本实现见`scripts/tts.mjs`、`trim.mjs`、`timeline.mjs`、`gate.mjs`。以下为其规则，改脚本时保持一致。

1. 稿子及画面方案确认后逐句合成，一句一个MP3，编号与文案句子ID对应。默认按文本、音色配置及音频hash复用；`-Ids`强制重做已有句子。
2. 显示文案与TTS文本分开保存。年份送入TTS前改成汉字，如1449年→一四四九年。多音字读错，用同音字或适当读音提示修改TTS文本；字幕保留原字。
3. 用FFmpeg的`silenceremove`结合`areverse`，分别去掉首尾静音。不使用`start_duration`或`stop_duration`参数。注意不要截掉低音量首尾字。
4. 用ffprobe读取处理后的句子时长。结合字数、正常语速和试听识别异常偏短、缺字或截断；仅重做异常句子，不用统一固定阈值误判短句。
5. 句后停顿`pause`可写数字（0.3–1.5秒）或档位：`beat`0.35（默认句间）、`turn`0.6（转折）、`breath`1.0（段落、钩子之后、反转之前）、`hold`1.5（重大落点）。转折停顿替代该位置普通句间停顿，避免无意叠加。超过0.6秒的停顿须写`pauseWhy`说明叙事理由，不为凑时长加停顿。长稿（≥20句）80%以上停顿相同时gate警告节奏单一。
6. 结尾留白用`script.tail`（秒，默认2，上限5），加在最后一句之后，画面与配音同步停留，用于读懂结尾提问。
7. 固定句子音频与停顿后建立完整配音时间轴。

## 字幕

豆包不返回字级时间戳。必须使用支持中文的强制对齐模型，对真实配音和已确认正文逐字对齐；不能按字数平均分配时间冒充强制对齐。

对每句裁剪后的WAV从0开始对齐，缓存句内相对时间；导出字幕时读取当前timeline，加上句子起点，不缓存旧全片偏移。TTS同音字替换与原文建立对应关系，字幕恢复原字；年份也保留原稿显示形式。断句依据口播节奏，检查专名、重叠、负时长、漏句以及偏移。保留字级结果用于局部更新，SRT按可读字幕块导出。字符缺失或时间不完整时失败，不能用平均时间或最后一字兜底。

对齐工具固定为whisperX的wav2vec2对齐（`scripts/align.py`，显式指定模型`jonatasgrosman/wav2vec2-large-xlsr-53-chinese-zh-cn`），只对齐不转写；安装`pip install whisperx`，首次运行下载模型及必要分词资源。缓存有效且没有指定重做时跳过推理；`--ids s001,s002`强制重做指定句，`--force`重做全部或所选句子。字幕块由`scripts/srt.mjs`生成。缺少依赖时在制作前说明并解决；不要把ASR粗略时间戳替代为已验证的逐字对齐。
