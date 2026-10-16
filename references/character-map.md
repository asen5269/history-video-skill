# 人物对峙地图风格

用户认可的参考方向：正俯视地形地图作为背景，两侧放写实漫画人物透明立绘，中央保留战场、军旗与关键地名；暖色区域填色、克制地形纹理、竖排姓名牌与底部字幕。用于人物关系、战役指挥与阵营对峙；普通疆域概览继续使用地图主导布局。

## 画面层次

从后到前：浅色或暖赭色地形 → 势力区域色块 → 水系与有依据的边界 → 地点/军旗/路线 → 人物立绘 → 姓名牌 → 字幕。地图配色随主题选择，不能把每场战役都做成黄褐色。

人物可在左右各占画面宽约25–35%，半身或胸像落在画面下缘，目光朝向中央或对手。中间保留战场与军旗，不让脸、肩甲、姓名牌遮住叙事落点。单人、群像按需要变体，不强制每镜两人。

姓名牌用独立排版：红底、白字、竖排可作为主样式，边缘略有笔触；文字尺寸以小屏识读为先。不要让生图负责姓名或字幕。粗白边界只强调当前冲突关系，其余边界较细；区分疆界、河流和行动路线，不能用一条白线混代三者。

人物是前景叙事资产；地图仍须有正确时期的几何和地点依据。背景不能只成为与台词无关的装饰。运动以区域揭示、地点聚焦、军旗变化、路线推进为主；人物可克制入场，不把人物平移冒充行军。

人物默认从左右屏外平移入场并淡入：0.65秒，缓出减速，无弹跳；姓名牌延后0.15秒淡入。每个人物可配置`entrance:{duration,delay,nameDelay}`，或`entrance:false`关闭。入场相对人物start计算，完全由time驱动；预览与Remotion使用同一函数，倒拖时间轴可重复得到同一画面。当前退场仍由end直接隐藏，不声称已实现退场动画。预览“重播入场”将时间轴回到0。

## 人物立绘

角色出场频率由故事决定，不限次数或累计时长。已验收立绘应复用以保持一致，不适用背景素材的“两镜头、20秒、10%”审查阈值。检查重点是每次出场的叙事作用、构图与姿态是否机械重复、是否反复播放无意义入场动画、是否遮挡地图。角色在相邻镜头持续存在时优先保持连续性，默认入场效果不等于每次切镜都重新入场。年龄、身份或服饰变化按档案建立变体，不能为凑素材数量换脸。细则见[制作规范·复用限制](production.md#复用限制与例外)。

### 从故事生成角色资产

正式制作按“已确认故事→角色档案→立绘→参考图复用→镜头配置”执行，不将预览中的匿名统帅、固定两人或固定服装套进新故事。

1. **提取角色**：从当前`script.json`和逐镜方案识别实际出场人物，分配稳定`characterId`，关联句子ID与镜头ID。按叙事作用决定哪些人物需要立绘；仅提及姓名不必生成。明确当前场景是介绍、合作、对峙或指挥，不能因有两个人就构造成敌对关系。
2. **建立角色档案**：在工程`characters.json`记录姓名、身份、出场年代、年龄或年龄段、身份变化、叙事作用、表情姿态、外观锚点、服饰装备依据、可用画像、艺术化部分与来源。年龄按事件年代核算；缺资料时标记未知或艺术选择，不捏造已知相貌。外观与衣冠依据史料和已确认美术设定，不按人物姓名或族属套刻板脸型。帝王不默认穿盔甲，文臣不默认武将装束。
3. **编译提示词**：角色档案提供人物内容；本片美术设定提供画风与光线；镜头布局提供景别、姿态、视线方向、边缘余量。三者合成每张立绘的实际提示词。风格可统一，年龄、服饰、神态不能统一成同一个模板。
4. **生成与验收**：按既有画面方案确认节点制作代表角色和试片，不额外强制每个人物单独审批。优先直接生成透明PNG；检查人物是否匹配档案、衣冠时代、构图、手部、Alpha及深浅背景边缘。修正后保存立绘与完整生成记录，不以提示词符合档案代替看图。
5. **锁定与变体**：验收后记录`referenceAssetId`及版本，后续同角色使用该参考图保持脸、发型和可识别特征。跨年龄、身份或重大服饰变化时建立有理由的`variantId`，不因每个镜头不同就重新生成一张脸。局部改档案只使相关变体/镜头失效，不重生成其他角色。
6. **绑定镜头**：镜头通过`characterId + variantId`找到已验收的`assetId`，再按叙事选择`map/single/duel`、左右位置、出现时间、姓名牌与入场参数。左右位置不等于地理位置或阵营归属。默认入场效果沿用当前用户确认版本，可逐镜覆盖。

`characters.json`是可编辑的工程记录，不是目前已有的自动提取器。执行者须按流程实际建立并核对档案；当前没有脚本能从任意故事自动完成角色理解、生图与验收，不声称已经全自动接通。现有预览的匿名人物只用于组件和动画测试，不得作为正式历史角色自动回退素材；缺角色图时继续准备对应资产，或明确选择纯地图镜头。

### 工程记录与组件输入

```json
{
  "version": 1,
  "scriptVersion": 1,
  "characters": [{
    "id": "character-001",
    "name": "故事中的实际人物姓名",
    "scriptIds": ["s001"],
    "shotIds": ["c01"],
    "identity": "该事件时期的身份",
    "period": "该镜头对应年代",
    "age": null,
    "appearanceAnchors": [],
    "costumeEvidence": [],
    "artisticChoices": [],
    "variants": [{
      "id": "variant-001",
      "assetId": "character-001-variant-001-v1",
      "representation": "illustration",
      "referenceAssetId": null,
      "status": "planned",
      "version": 1
    }]
  }]
}
```

示例占位文字只说明结构，正式记录写实际角色资料；未验收状态不得写`approved`。详细来源留在工程研究记录，角色档案引用定位。生成后在`assets.json`登记实际文件、提示词记录与`characterId/variantId/version`，将资产映射为组件需要的`id/src/representation/period/source/version`。人物名字来自档案；场景的`characters`仅保存本镜所需的人物引用和布局参数。当前角色映射与内容一致性由人工核对，既有gate不验证这些新增记录。

允许生成明确的历史人物艺术化示意面孔，不要求其真实相貌。工程人物资产记录 `representation:"illustration"`、服饰时代依据、画风参考及版本；不冒充史料画像，不声称外貌复原。史料画像模式仍保留原貌，不重绘面部。

风格锚点：写实漫画/历史游戏立绘；粗细变化轮廓线；硬朗但自然的面部结构；盔甲、皮毛和布料有材质差别；低饱和服装；明确明暗塑形。两人共享画风、光向、色温与细节密度，避免一人照片、一人动漫。同人物后续镜头使用角色参考，不能只靠文字反复重新生成。

提示词骨架（按具体人物、时期修改）：

```text
Historical illustrated character asset, semi-realistic graphic novel rendering.
Subject: [historical character], artistic interpretation, not a verified likeness.
Period costume: [documented period clothing and equipment].
Waist-up, [pose and gaze], full head and both shoulders inside frame,
expressive face, varied ink contour lines, convincing armor/fur/fabric,
restrained garment colors, sculpted directional light from [direction].
Single isolated character on a fully transparent background, clean alpha edges.
No scenery, solid background, checkerboard, text, nameplate, logo or watermark.
```

## 透明资产生成

优先直接生成真实透明PNG，不将抠图设为必经步骤。gpt-image-2官方透明背景能力标为preview：`background="transparent"`，`output_format="png"`或`webp`。依据：[官方透明背景说明](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide#transparent-backgrounds-with-gpt-image-2-preview)。第三方兼容接口和具体模型别名须实测，不据官方能力推定当前代理也支持。

使用本skill脚本时，艺术化人物须显式开启模式：

```text
node scripts/imagegen.mjs --portrait-mode illustration --background transparent --size 1024x1536 --prompt "<人物提示词>" --out <工程>/assets/characters/character.png
```

脚本默认模式仍排除可识别人脸；illustration仅解除该项，不解除印章、水印和文字限制。已存在可信画像时可直接接入史料资产，不需要开启此模式。

生成后检查PNG/WebP的Alpha通道存在且实际含透明像素；棋盘格不能画进图里。分别在浅底、深底上检查头发、皮毛、肩甲、衣服边缘、白边和半透明噪声。真实透明仍须检查人物细节，不把“带Alpha”当作美术通过。接口不支持时先说明，再选支持的工具或背景移除；不重复付费盲试。

## 公共组件配置

预留独立 `characters` 数据：`id/assetId/src/name/side/rect/nameplate/representation/start/end`，与 `regions/places/flags/routes/camera` 分离。人物rect、姓名牌rect和字幕安全区应作为标签避让的障碍，中央战场为取景重点。角色资产归工程角色库，渲染器不包含人物姓名、脸或朝代。

已实现公共React组合层`assets/history-map/src/StoryMapView.tsx`与Remotion适配`RemotionStoryMap.tsx`。资产数组保存`id/src/representation/period/source/version`；人物配置保存`assetId/name/side/start/end/color`；布局为`map/single/duel`，主题配置姓名牌、文字与字幕底色。人物性质由资产记录承载，不由布局或生图脚本推定。底层`HistoryMapView`继续独立使用。

地图`autoFit`启用时组合层按布局设置中央安全区；人物与字幕矩形转换为逻辑像素后传给标签避让。图片预载完成与地图就绪后才解除Remotion等待，人物出现时间由time驱动。当前仅支持左右预设人物框和竖排姓名牌，不宣称任意群像与自定义rect已实现。接入后实际检查小屏识读、遮挡、人物风格统一、阵营与地理关系；只根据真实样片记录通过。

`imagegen.mjs --portrait-mode illustration`保留为生图阶段的提示词策略，不作为资产身份来源；资产representation必须另行记录。组件消费已有资产，不在渲染或切换布局时调用生图接口。
