# 生图接口

当前默认只按需生成地图上的独立插图，不生成背景、完整场景或地图。底图与疆界来自有依据的地理数据；已有史料画像和合适插图可直接使用，不把生图设为必经步骤。透明插图须实际检查Alpha与边缘，纯色底或画出的棋盘格不算透明。

统一调用`scripts/imagegen.mjs`，协议为OpenAI兼容Images API，默认模型gpt-image-2.5-1k（1K档，已实测）。

## 配置

凭据文件名`.env`或`key.env`，放在项目目录或其上级（如`F:\ai-video-work\历史视频\key.env`供所有项目共用），脚本从输出路径逐级向上查找；已设置的环境变量优先。格式见[配音规范](voice.md#凭据)。

```
HV_IMAGE_BASE_URL=https://host        # 不带/v1时自动补
HV_IMAGE_API_KEY=...
HV_IMAGE_MODEL=gpt-image-2.5-1k  # 可选
HV_IMAGE_SIZE=1536x1024          # 可选，默认1024x1024
```

缺失时只暂停生图步骤，说明缺什么；不以程序绘制图形冒充AI图。

## 调用

```
node scripts/imagegen.mjs --prompt "<独立主体提示词>" --out <项目>/assets/gen/c01_illustration.png --background transparent
node scripts/imagegen.mjs --prompt "..." --out ... --ref <项目>/assets/gen/style_key.png   # 参考图保持画风，多张用逗号分隔
node scripts/imagegen.mjs --prompt "..." --out ... --background transparent              # 透明底分层素材
```

- 无`--ref`走`/images/generations`；有`--ref`走`/images/edits`。参考图会先复制为ASCII临时文件名再交给curl，中文路径可用。
- 两种请求都传`background`；用参考图生成分层素材时仍须指定`--background transparent`，不因有参考图而忽略透明设置。实际检查输出透明度，服务端不支持时直接说明。
- 每张图旁写`<文件>.json`记录实际发送的提示词、模型、请求尺寸、背景设置与参考图，供重做和追踪；记录参数不等于保证随机生图逐像素复现。命令行未指定尺寸时，读取环境或项目`.env`的`HV_IMAGE_SIZE`。
- 实测：方图返回约1254×1254，`-Size 1536x1024`返回1536×1024；单张约60–70秒，响应为图片URL（脚本自动下载）。
- 生成尺寸不等于成片尺寸；需要16:9或更大视差余量时，用FFmpeg缩放裁切，不要求接口直出1920×1080。
- 脚本默认排除所有文字；正式封面的确认标题由可靠排版工具叠加，不能指望生图同时生成标题。

## 分层出图（配合[镜头运动](motion.md)）

1. 先以实际地图和代表插图建立风格样张；已有合适素材时不额外生图。
2. 按镜头需要生成独立人物、建筑或道具插图，使用--background transparent；不生成天空、远山或完整场景。
3. 提示词写明主体、时代、状态与画风，已锁定的主体参考用于一致性；在实际地图上检查比例、Alpha边缘及地名遮挡。
4. 生成后实际检查：印章、水印、文字、人脸、时代错误（衣冠、船型、建筑）。不合格重生成或编辑，不以“提示词已排除”为合格。
