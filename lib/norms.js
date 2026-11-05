// 专业分析规范：把权威教材/考试大纲拆成「可判定的标准 + 术语判据卡 + 理论框架 + 评分卡」。
// 说明：本文件为原创整理（改写与归纳），不含教材原文、扫描件或完整笔记；引用出处见 SOURCES。
// 主要来源：张菁/关玲《影视视听语言（第三版）》（中国传媒大学出版社，2020.9；
// 上海自考《视听语言》07189 2026 版大纲指定教材）、上海自考大纲、阿里洪《电影语言的语法》、
// 卡茨《电影镜头设计》、Bordwell & Thompson《Film Art》、中国大百科全书（第三版）影视学。

export const SOURCES = [
  {
    id: 'zhangjing',
    title: '影视视听语言（第三版）',
    author: '张菁、关玲',
    publisher: '中国传媒大学出版社',
    year: '2020.9',
    note: '上海市高等教育自学考试《视听语言》（07189）2026 版大纲指定教材',
  },
  {
    id: 'shmeea',
    title: '上海市高等教育自学考试《视听语言》（07189）自学考试大纲（2026 年版）',
    author: '上海大学高等教育自学考试办公室编',
    publisher: '上海市高等教育自学考试委员会组编',
    year: '2026',
    note: '章节知识点与识记/领会/简单应用/综合应用四层考核要求',
  },
  {
    id: 'arijon',
    title: '电影语言的语法（插图修订版）',
    author: '丹尼艾尔·阿里洪',
    publisher: '中国电影出版社（初版）/ 北京联合出版公司（插图修订版）',
    note: '摄影机位、场面调度、三角形原理、内外反拍、双人对话调度',
  },
  {
    id: 'katz',
    title: '电影镜头设计：从构思到银幕（插图第 2 版）',
    author: '史蒂文·卡茨',
    publisher: '世界图书出版公司',
    year: '2010.04',
    note: '上海自考大纲参考教材；分镜与视点设计',
  },
  {
    id: 'bordwell',
    title: 'Film Art: An Introduction（第 12 版）',
    author: 'David Bordwell & Kristin Thompson',
    publisher: 'McGraw-Hill',
    year: '2019',
    note: 'Mise-en-scène / Cinematography / Editing / Sound / Style 的经典分析框架',
  },
  {
    id: 'zgbk',
    title: '中国大百科全书（第三版）·影视学',
    author: '中国大百科全书出版社',
    note: '术语权威核对（电影景别、长镜头、声音设计等条目）',
  },
  {
    id: 'tup',
    title: '文艺常识考试全攻略·电影章',
    author: '清华大学出版社',
    note: '编导艺考常用术语与判据（景别、角度、镜头运动、光线、色彩、构图、声音）',
  },
];

/** 维度判定标准：criteria 是可观察、可核对的判据，避免形容词式空话。 */
export const DIMENSION_STANDARDS = [
  {
    id: 'shotSize',
    name: '景别',
    definition: '被摄主体在单个镜头画面中所呈现的范围，以及由此带来的信息量差异。',
    criteria: [
      '按主体占画幅比例与裁剪点判定：环境为主/全身/膝盖以上/胸部以上/肩部以上/细节',
      '看环境信息量：远景交代空间，全景交代人与环境关系，中景交代动作关系，近景看表情，特写看细节',
      '看叙事功能：是否用于暗示空间、表现情感距离、建构视觉风格',
      '注意两极镜头（远景↔特写直切）与景别匹配规则',
    ],
    categories: ['大远景', '远景', '全景', '中景', '近景', '特写', '大特写', '两极镜头'],
    pitfalls: ['把中景误判为近景（只看人物大小、不看裁剪点）', '忽略环境信息量，只按人脸大小判断', '把特写当近景（忽略肩部以上的裁剪）'],
    evidence: ['画面裁剪点', '主体占画幅比例', '环境可见度'],
    source: 'zhangjing',
  },
  {
    id: 'depthFocal',
    name: '景深与焦距',
    definition: '镜头焦距与光圈共同决定的透视关系与清晰范围。',
    criteria: [
      '看前景到背景的清晰范围：深焦/浅景深',
      '看透视：短焦夸大纵深与近大远小，长焦压缩空间、虚化背景',
      '区分变焦（透视不变、画面缩放）与推轨（透视变化、空间位移）',
      '追焦/焦点转移是否承担叙事（引导注意力、揭示关系）',
    ],
    categories: ['短焦/广角', '中焦', '长焦', '变焦', '深焦', '浅景深', '跟焦'],
    pitfalls: ['把变焦当推镜头（忽略透视变化）', '把背景虚化一律归因于长焦（也可能是大光圈近摄）'],
    evidence: ['清晰范围', '畸变与透视', '焦点变化过程'],
    source: 'zhangjing',
  },
  {
    id: 'anglePosition',
    name: '角度与视点',
    definition: '摄影机相对被摄体的高度、方位与视点归属，决定权力关系与观众位置。',
    criteria: [
      '看摄影机高度：平视/俯拍/仰拍（及顶拍、底拍）',
      '判断视点归属：客观视点、主观视点、导演诠释视点、间接主观视点',
      '看视线匹配与正反打是否成立',
      '看角度建立的权力关系（仰拍强化、俯拍弱化、平视对等）',
    ],
    categories: ['平视', '俯拍', '仰拍', '客观视点', '主观视点', '导演诠释视点', '间接主观视点', '正反打'],
    pitfalls: ['把俯拍画面一律当主观视点', '只看角度不看视点归属', '忽略视线方向与轴线'],
    evidence: ['机位高度', '视线方向', '人物在画框中的位置'],
    source: 'zhangjing',
  },
  {
    id: 'lightTone',
    name: '光线与影调',
    definition: '光源方向、性质、强度关系与画面明暗结构（影调）的总和。',
    criteria: [
      '看光源方向：顺光/侧光/逆光/顶光/底光/侧逆光',
      '看光源性质：自然光/人工光、硬光/软光',
      '看光比与明暗结构：高调/低调/硬调/软调',
      '看光影是否承担叙事：制造景深、写心境、造悬念',
      '看布光方法（三点布光：主光/辅光/轮廓光）与光源动机',
    ],
    categories: ['顺光', '侧光', '逆光', '顶光', '底光', '高调', '低调', '硬调', '软调', '三点布光'],
    pitfalls: ['把“低调”等同于画面暗（低调是暗部为主、光比大）', '忽略色温对影调的影响', '把所有逆光当剪影'],
    evidence: ['明暗分布', '阴影方向', '高光位置', '光比估算'],
    source: 'zhangjing',
  },
  {
    id: 'colorPalette',
    name: '色彩与色调',
    definition: '色相、明度、纯度、色温与色彩关系构成的视觉情绪系统。',
    criteria: [
      '看色彩三属性：色相/明度（色值）/纯度',
      '看色温与冷暖倾向（相对中性白的偏移）',
      '看色彩关系：相似/对比（色别、色值、纯度）',
      '看色调统一性、主题色与色彩节奏（重复/渐变/突变）',
      '看色彩的情绪与象征功能是否服务主题',
    ],
    categories: ['暖调', '冷调', '相似色', '对比色', '主题色', '色彩节奏', '色温'],
    pitfalls: ['把饱和度当明度', '只看滤镜冷暖，忽略美术/服装/道具的色彩设计', '把颜色象征说得过满而无画面证据'],
    evidence: ['主色占比', '色温倾向', '色彩关系', '主题色出现位置'],
    source: 'zhangjing',
  },
  {
    id: 'composition',
    name: '构图',
    definition: '画面内视觉元素的位置、比例、线条与空间关系组织。',
    criteria: [
      '看主体位置：几何中心/视觉中心/黄金分割点/三分线',
      '看构图方法：对称、均衡、集中、对比、隐喻、几何线形、纵深、主体与陪体',
      '看前景/背景/留白与框中框',
      '看画幅比与空间压缩/扩展',
      '看构图是否引导视线、突出主体、制造隐喻',
    ],
    categories: ['三分法', '黄金分割', '对称', '均衡', '集中', '对比', '纵深', '框景', '留白'],
    pitfalls: ['把三分法当唯一正确标准（中心构图在对称/压迫感表达中同样有效）', '忽略纵深与前景关系', '只描述元素位置，不解释视觉引导'],
    evidence: ['主体坐标', '线条方向', '前景遮挡', '画幅比'],
    source: 'zhangjing',
  },
  {
    id: 'cameraMovement',
    name: '镜头运动',
    definition: '摄影机在空间中的运动方式及其与人物调度的关系。',
    criteria: [
      '区分固定镜头与运动镜头；运动类型：摇/推/拉/移/跟/升降/手持/稳定器/综合运动',
      '看运动方向、速度、稳定性与动机（跟随、引导、揭示、情绪）',
      '看运动是否改变空间关系、制造悬念、参与节奏',
      '区分光学变焦与物理移动（透视是否变化）',
    ],
    categories: ['固定', '摇', '推', '拉', '移', '跟', '升降', '手持', '稳定器', '综合运动'],
    pitfalls: ['把变焦当推镜', '把手持一律当缺点（可能是风格选择）', '只描述运动方向，不解释运动动机'],
    evidence: ['画框位移', '透视变化', '背景流动', '抖动程度'],
    source: 'zhangjing',
  },
  {
    id: 'miseEnScene',
    name: '场面调度',
    definition: '人物调度与镜头调度在空间中的综合组织。',
    criteria: [
      '看人物调度：走位、站位、距离、朝向、动作线',
      '看镜头调度：机位、运动、焦段、视角',
      '看综合调度：人物与镜头如何共同组织空间、引导注意力',
      '看调度与叙事/权力关系/情绪的关系',
    ],
    categories: ['人物调度', '镜头调度', '综合调度', '纵深调度', '平面调度'],
    pitfalls: ['只分析演员表演，忽略机位运动', '只分析机位，忽略人物走位', '忽略轴线与空间连续性'],
    evidence: ['人物位置变化', '机位变化', '空间纵深关系'],
    source: 'arijon',
  },
  {
    id: 'editing',
    name: '剪辑与蒙太奇',
    definition: '镜头之间的组接方式，以及由组接产生的叙事、节奏与意义。',
    criteria: [
      '看切点依据：动作匹配、视线匹配、图形/色彩匹配、声音匹配',
      '看镜头时长分布与节奏（平均镜头长度、长短交替）',
      '看经典剪辑规则：180 度原则、三角形机位、三镜头法、交叉/平行剪辑',
      '看蒙太奇类型：叙事蒙太奇、表现蒙太奇、杂耍蒙太奇、理性蒙太奇',
      '看风格化剪辑：跳接、非连贯剪辑、转场设计',
    ],
    categories: ['动作匹配', '视线匹配', '图形匹配', '声音匹配', '三镜头法', '交叉剪辑', '平行剪辑', '跳接', '非连贯剪辑'],
    pitfalls: ['把长镜头当“没有剪辑”（长镜头是剪辑决策的另一种形式）', '只数切点，不分析切点依据', '把任何快速剪辑都当蒙太奇'],
    evidence: ['切点时间码', '镜头时长序列', '匹配依据', '轴线关系'],
    source: 'zhangjing',
  },
  {
    id: 'sound',
    name: '声音与声画关系',
    definition: '对白、音效、音乐、画外音与无声的组织，及其与画面的时空关系。',
    criteria: [
      '分类：对白/音效/电影音乐/画外叙述声（内心独白、旁白、解说词）/无声',
      '看声源可见性：画内/画外；主观/客观声音',
      '看声画关系：同步、分离、对位',
      '看声音的空间感（混响、远近、景别）与转场功能',
      '看静默/留白是否参与情绪与节奏',
    ],
    categories: ['对白', '音效', '电影音乐', '画外音', '内心独白', '旁白', '解说词', '无声', '声画同步', '声画分离', '声画对位'],
    pitfalls: ['把配乐当音效', '把画外音一律当旁白', '只列声音元素，不分析声画关系'],
    evidence: ['声源', '声画同步点', '音量/静音数据', '音乐进入与退出时间'],
    source: 'zhangjing',
  },
];

/** 术语判据卡：定义 + 判定要点 + 常见误用；用于提示词与面板速查。 */
export const TERMS = [
  // 景别
  { term: '远景', category: '景别', definition: '以环境为主、人物占画幅很小的景别，用于交代空间与气氛。', criteria: '人物不占主要位置；环境信息量最大。', misuse: '把全景当远景（人物全身仍占主要位置时应为全景）。', source: 'zhangjing' },
  { term: '全景', category: '景别', definition: '表现成年人全身或场景全貌的景别，用于呈现人与环境的关系。', criteria: '人物全身可见且占画面主要位置；能看清动作与环境。', misuse: '忽略“人与环境关系”这一核心功能。', source: 'zhangjing' },
  { term: '中景', category: '景别', definition: '表现成年人膝盖以上或场景局部的景别，长于表现上半身动作与人物关系。', criteria: '裁剪点在膝部以上、胸部以下；双人对话常用。', misuse: '把中景当近景（裁剪点判断错误）。', source: 'zhangjing' },
  { term: '近景', category: '景别', definition: '表现人物胸部以上或物体局部的景别，长于表现面部表情与心理活动。', criteria: '裁剪点在胸部以上；面部表情清晰。', misuse: '把近景当特写（忽略肩部以上）。', source: 'zhangjing' },
  { term: '特写', category: '景别', definition: '表现人物肩部以上头像或主体细节的景别，用于强调与放大。', criteria: '肩部以上或细节充满画面；强调作用明显。', misuse: '把特写用于交代环境（功能错位）。', source: 'zhangjing' },
  { term: '大特写', category: '景别', definition: '比特写更近的景别，只拍眼睛、手部等局部细节。', criteria: '局部细节占据画面绝大部分。', misuse: '与特写混用、不区分强调强度。', source: 'tup' },
  { term: '两极镜头', category: '景别', definition: '前后镜头景别跨度极大（远景/全景直切近景/特写）的组接方式。', criteria: '相邻镜头景别跨度大，产生强调或冲击。', misuse: '把普通景别变化都称两极镜头（跨度不够大）。', source: 'shmeea' },
  // 景深焦距
  { term: '景深', category: '景深焦距', definition: '画面中从近到远保持清晰的范围。', criteria: '前景到背景的清晰范围；与光圈、焦距、物距有关。', misuse: '把背景虚化当景深本身（景深是清晰范围）。', source: 'zhangjing' },
  { term: '深焦镜头', category: '景深焦距', definition: '前景到远景都清晰的镜头，常用于多平面叙事与场面调度。', criteria: '前后景均清晰；场面信息可同时阅读。', misuse: '把广角大景深画面一律当深焦（需看清晰范围）。', source: 'bordwell' },
  { term: '浅景深', category: '景深焦距', definition: '只有主体所在平面清晰、前后景虚化的画面效果。', criteria: '清晰范围窄；背景明显虚化。', misuse: '把长焦压缩空间与浅景深混为一谈。', source: 'bordwell' },
  { term: '短焦镜头', category: '景深焦距', definition: '焦距较短的镜头，视角宽、纵深感强、易产生畸变。', criteria: '近大远小明显；走廊/室内纵深被夸大。', misuse: '把广角畸变当成布景问题。', source: 'zhangjing' },
  { term: '长焦镜头', category: '景深焦距', definition: '焦距较长的镜头，视角窄、压缩空间、背景易虚化。', criteria: '前后景被压缩；人物与背景距离感变近。', misuse: '把手持长焦的晃动归因于设备问题。', source: 'zhangjing' },
  { term: '变焦镜头', category: '景深焦距', definition: '通过改变焦距缩放画面，透视关系基本不变的光学运动。', criteria: '画面放大/缩小但透视不变；与物理推轨区分。', misuse: '把变焦当推镜头（运动性质不同）。', source: 'katz' },
  // 角度视点
  { term: '平视', category: '角度视点', definition: '摄影机与被摄体大致同高的角度，接近日常观察，显得平稳、对等。', criteria: '机位高度与人物视线大致齐平。', misuse: '把轻微俯拍仍称平视（需看视线水平）。', source: 'tup' },
  { term: '俯拍', category: '角度视点', definition: '摄影机从高处向下拍摄的角度，易使对象显得渺小、被压制。', criteria: '机位高于被摄体、向下俯视。', misuse: '把俯拍画面一律理解为“同情”（需结合语境）。', source: 'zhangjing' },
  { term: '仰拍', category: '角度视点', definition: '摄影机从低处向上拍摄的角度，易使对象显得高大、有压迫感或崇高感。', criteria: '机位低于被摄体、向上仰视。', misuse: '把仰拍一律用于正面人物（也可用于反派压迫感）。', source: 'zhangjing' },
  { term: '客观视点', category: '角度视点', definition: '摄影机作为旁观记录者呈现场景，不代入任何人物视角。', criteria: '画面不跟随特定人物的视线或身体位置。', misuse: '把第三人称叙事一律当客观视点（需看镜头归属）。', source: 'shmeea' },
  { term: '主观视点', category: '角度视点', definition: '模拟某个人物眼睛所见的视点镜头。', criteria: '画面位置与人物视线、身体动作一致。', misuse: '把特写当主观视点（需有视点归属依据）。', source: 'shmeea' },
  { term: '导演诠释视点', category: '角度视点', definition: '导演主动选择、引导观众观看方式的视点。', criteria: '机位/构图明显带有评价性，而非人物视角。', misuse: '把常规客观镜头当导演诠释（需有引导意图证据）。', source: 'shmeea' },
  { term: '间接主观视点', category: '角度视点', definition: '接近人物动作、让观众卷入情节但又不完全等于人物视角的视点。', criteria: '镜头贴近人物动作与身体，但保留旁观距离。', misuse: '与主观视点混用。', source: 'shmeea' },
  { term: '正反打', category: '角度视点', definition: '双人对话中交替呈现双方视线的剪辑方式，通常遵循轴线与三角形机位。', criteria: '两个机位分居轴线两侧；视线方向相反。', misuse: '越轴仍称正反打（需检查轴线）。', source: 'arijon' },
  // 光线影调
  { term: '光比', category: '光线影调', definition: '画面亮部与暗部的亮度差，决定影调硬度与情绪强度。', criteria: '主光与辅光的亮度差；明暗对比程度。', misuse: '把画面整体亮度当光比。', source: 'zhangjing' },
  { term: '三点布光', category: '光线影调', definition: '主光、辅光、轮廓光构成的基本布光方法。', criteria: '主光定方向与明暗，辅光补暗部，轮廓光分离背景。', misuse: '把三点布光当唯一布光法（自然光场景另论）。', source: 'shmeea' },
  { term: '高调', category: '光线影调', definition: '以亮部为主、光比较小的影调，常显得明快、轻盈。', criteria: '画面大面积明亮；暗部少、光比小。', misuse: '把高调当高亮度（需看明暗结构）。', source: 'zhangjing' },
  { term: '低调', category: '光线影调', definition: '以暗部为主、光比较大的影调，常显得压抑、神秘。', criteria: '画面大面积暗；亮部集中在局部；光比大。', misuse: '把低调当“画面欠曝”。', source: 'zhangjing' },
  { term: '硬调', category: '光线影调', definition: '明暗对比强、阴影边缘锐利的影调。', criteria: '光比大；阴影边界清晰。', misuse: '与低调混用（低调讲明暗面积，硬调讲对比强度）。', source: 'zhangjing' },
  { term: '软调', category: '光线影调', definition: '明暗过渡柔和、光比较小的影调。', criteria: '阴影边缘柔和；整体反差低。', misuse: '把低饱和当软调。', source: 'zhangjing' },
  // 色彩
  { term: '色相', category: '色彩色调', definition: '颜色的基本相貌（红、黄、蓝等），是色彩三属性之一。', criteria: '识别画面主色的色相归属。', misuse: '把明度变化当色相变化。', source: 'zhangjing' },
  { term: '明度', category: '色彩色调', definition: '颜色的明暗程度（色值），是色彩三属性之一。', criteria: '同色相下颜色深浅的变化。', misuse: '把饱和度当明度。', source: 'zhangjing' },
  { term: '纯度', category: '色彩色调', definition: '颜色的饱和程度，是色彩三属性之一。', criteria: '颜色鲜艳或灰浊的程度。', misuse: '把明度当纯度。', source: 'zhangjing' },
  { term: '色温', category: '色彩色调', definition: '光源颜色偏向的量化表达，暖光色温低、冷光色温高。', criteria: '画面整体偏黄/偏蓝；白平衡参照。', misuse: '把调色滤镜一律当色温设计。', source: 'zhangjing' },
  { term: '色调', category: '色彩色调', definition: '画面整体色彩倾向与统一性，是色彩设计的总效果。', criteria: '主色占比、冷暖倾向、色彩统一或冲突。', misuse: '把单一颜色当色调（色调是整体关系）。', source: 'zhangjing' },
  { term: '主题色', category: '色彩色调', definition: '贯穿影片或段落、承载主题意义的反复出现的颜色。', criteria: '同一颜色在不同场景反复出现并关联主题。', misuse: '把偶然同色当主题色（需重复与叙事关联）。', source: 'zhangjing' },
  { term: '色彩节奏', category: '色彩色调', definition: '色彩在时间上的重复、渐变、突变所形成的节奏。', criteria: '色彩变化与剪辑/叙事节点对应。', misuse: '只看单帧色彩，忽略时间维度。', source: 'shmeea' },
  // 构图
  { term: '三分法', category: '构图', definition: '把画面横竖三等分，将主体放在三分线或交点上的构图方法。', criteria: '主体位于三分线/交点；画面均衡。', misuse: '把三分法当唯一标准（对称/中心构图同样有效）。', source: 'bordwell' },
  { term: '黄金分割', category: '构图', definition: '按约 0.618 比例分割画面的构图方法，视觉上更自然。', criteria: '主体或分割线接近黄金比例位置。', misuse: '与三分法混用、不区分比例。', source: 'shmeea' },
  { term: '对称构图', category: '构图', definition: '画面左右或上下元素镜像对称的构图，常显得稳定、庄重或压迫。', criteria: '中轴两侧元素近似镜像。', misuse: '把均衡当对称（均衡不要求镜像）。', source: 'zhangjing' },
  { term: '纵深构图', category: '构图', definition: '利用前景、中景、背景组织空间层次的构图方法。', criteria: '画面存在明确前中后景；视线沿纵深线延伸。', misuse: '把平面构图当纵深（需有空间层次）。', source: 'zhangjing' },
  { term: '框中框', category: '构图', definition: '用门窗、镜子等元素在画面内再形成一个画框的构图。', criteria: '画面内存在明显的二次框架。', misuse: '把普通前景遮挡当框中框。', source: 'bordwell' },
  { term: '主体与陪体', category: '构图', definition: '画面中承担主要信息的主体与辅助主体的陪体之间的关系。', criteria: '主体位置/焦点/亮度突出；陪体起衬托作用。', misuse: '把陪体当主体（需看视觉重心）。', source: 'zhangjing' },
  // 运动
  { term: '固定镜头', category: '镜头运动', definition: '摄影机位置与角度不变拍摄的镜头，画面稳定、强调内部调度。', criteria: '画框不动；人物/光线在画内运动。', misuse: '把轻微手持晃动当固定镜头。', source: 'zhangjing' },
  { term: '摇镜头', category: '镜头运动', definition: '摄影机位置不动、机身水平或垂直转动的运动镜头。', criteria: '画框转动；背景连续移动。', misuse: '把移镜头当摇镜头（机位是否移动）。', source: 'zhangjing' },
  { term: '推镜头', category: '镜头运动', definition: '摄影机向被摄体方向移动、画面逐渐放大的运动镜头。', criteria: '机位前移；透视变化明显。', misuse: '把变焦当推镜（透视不变的是变焦）。', source: 'zhangjing' },
  { term: '拉镜头', category: '镜头运动', definition: '摄影机远离被摄体、画面逐渐缩小的运动镜头。', criteria: '机位后移；环境信息逐渐增加。', misuse: '与变焦拉远混淆。', source: 'zhangjing' },
  { term: '移镜头', category: '镜头运动', definition: '摄影机沿某一方向平行移动拍摄的运动镜头。', criteria: '机位平移；前景与背景相对移动。', misuse: '与摇镜头混淆（机位是否移动）。', source: 'zhangjing' },
  { term: '跟镜头', category: '镜头运动', definition: '摄影机跟随运动主体拍摄、保持主体在画面中相对稳定的运动镜头。', criteria: '主体位置稳定；背景持续流动。', misuse: '把固定机位拍运动当跟镜头。', source: 'zhangjing' },
  { term: '升降镜头', category: '镜头运动', definition: '摄影机垂直上下运动拍摄的镜头，常伴随空间与权力关系变化。', criteria: '机位高度明显改变。', misuse: '把俯仰角度变化当升降。', source: 'katz' },
  { term: '手持摄影', category: '镜头运动', definition: '摄影师手持摄影机拍摄的方式，画面易有晃动，常制造临场感或不安。', criteria: '画面晃动/呼吸感；无稳定器痕迹。', misuse: '把手持一律当技术缺陷（可能是风格）。', source: 'bordwell' },
  { term: '长镜头', category: '镜头运动', definition: '持续时间较长、不通过剪切断开的镜头，可分为记录式、叙事性、时间长镜头。', criteria: '单镜头持续数分钟；内部有调度与信息变化。', misuse: '把任意长时长镜头都当长镜头（需看是否连续）。', source: 'zhangjing' },
  // 场面调度
  { term: '场面调度', category: '场面调度', definition: '通过人物走位与摄影机运动共同组织空间、引导注意力的方法。', criteria: '人物调度+镜头调度；空间关系变化。', misuse: '只谈演员表演或只谈机位。', source: 'arijon' },
  { term: '人物调度', category: '场面调度', definition: '通过人物的走位、站位、距离与朝向组织画面与叙事。', criteria: '人物位置变化与画面构图/视线的关系。', misuse: '把人物调度当表演设计。', source: 'arijon' },
  { term: '镜头调度', category: '场面调度', definition: '通过机位、运动、焦段、视角变化组织画面与叙事。', criteria: '机位与镜头运动如何改变空间关系。', misuse: '把镜头调度当纯技术运动。', source: 'arijon' },
  { term: '三角形机位', category: '场面调度', definition: '在轴线一侧建立三个机位（全景/正打/反打）以覆盖对话场景的调度系统。', criteria: '三个机位不越轴；覆盖不同景别。', misuse: '越轴仍按三角形机位分析。', source: 'arijon' },
  // 剪辑蒙太奇
  { term: '180度原则', category: '剪辑', definition: '保持人物关系轴线一致，摄影机不越过轴线的剪辑规则。', criteria: '相邻镜头中人物左右关系保持不变。', misuse: '把有意的越轴当错误（需看是否风格化）。', source: 'shmeea' },
  { term: '三镜头法', category: '剪辑', definition: '双人对话中由全景/正打/反打三个镜头构成场景的经典拍摄方法。', criteria: '三镜头覆盖对话；轴线一致。', misuse: '把任意正反打都称三镜头法。', source: 'arijon' },
  { term: '匹配剪辑', category: '剪辑', definition: '利用画面造型、运动、位置或视线相似性把两个镜头无缝连接。', criteria: '动作/视线/图形/位置匹配。', misuse: '把普通切当匹配（需有匹配依据）。', source: 'zhangjing' },
  { term: '交叉剪辑', category: '剪辑', definition: '在两条或多条动作线之间来回切换，制造同时性与悬念。', criteria: '不同空间的动作交替出现。', misuse: '把顺序剪辑当交叉剪辑。', source: 'shmeea' },
  { term: '平行剪辑', category: '剪辑', definition: '把两条或多条叙事线并列推进，形成对照或呼应。', criteria: '线索并列、主题相关。', misuse: '与交叉剪辑混用（交叉强调同时性）。', source: 'zhangjing' },
  { term: '跳接', category: '剪辑', definition: '在连续动作中故意省略时间或空间、造成跳跃感的剪辑。', criteria: '同一主体位置/时间突然跳变。', misuse: '把正常切点当跳接。', source: 'shmeea' },
  { term: '蒙太奇', category: '剪辑', definition: '通过镜头组接产生新意义的剪辑方法；苏联蒙太奇理论强调冲突与联想。', criteria: '镜头并置产生超出单镜的意义。', misuse: '把所有剪辑都叫蒙太奇（需有表意组接）。', source: 'zhangjing' },
  { term: '杂耍蒙太奇', category: '剪辑', definition: '爱森斯坦提出的以强烈刺激与冲突组合引导观众情绪的蒙太奇方法。', criteria: '镜头并置产生强烈情绪/观念冲击。', misuse: '把普通快切当杂耍蒙太奇。', source: 'bordwell' },
  { term: '理性蒙太奇', category: '剪辑', definition: '通过镜头并置表达抽象概念与思想的蒙太奇方法。', criteria: '镜头组接产生概念性推理。', misuse: '把叙事性组接当理性蒙太奇。', source: 'bordwell' },
  // 声音
  { term: '对白', category: '声音', definition: '角色之间用于交流的台词声音。', criteria: '声源为画面内/外人物；承担叙事与人物塑造。', misuse: '把旁白当对白。', source: 'zhangjing' },
  { term: '音效', category: '声音', definition: '除对白和音乐之外的环境声、动作声、特殊效果声。', criteria: '声源来自动作/环境；承担叙事、情绪、转场功能。', misuse: '把配乐当音效。', source: 'zhangjing' },
  { term: '电影音乐', category: '声音', definition: '为影片创作或选用的音乐，承担情绪、叙事与结构功能。', criteria: '有旋律/节奏组织；进入退出与叙事节点相关。', misuse: '把环境声当音乐。', source: 'zhangjing' },
  { term: '画外音', category: '声音', definition: '声源不在画面内的声音，包括画外对白、旁白、解说等。', criteria: '声源不可见但空间上可信。', misuse: '把画外音一律当旁白。', source: 'zhangjing' },
  { term: '内心独白', category: '声音', definition: '以人物内心声音形式出现的画外叙述，带有主观心理色彩。', criteria: '第一人称、贴近人物心理。', misuse: '与旁白混用（旁白可非人物内心）。', source: 'shmeea' },
  { term: '旁白', category: '声音', definition: '由叙述者讲述故事、交代信息的画外声音。', criteria: '叙述者视角；常承担时间/背景交代。', misuse: '把人物内心独白当旁白。', source: 'shmeea' },
  { term: '解说词', category: '声音', definition: '纪录片/电视节目中解释画面、补充信息的画外语言。', criteria: '说明性、信息性；与画面互补。', misuse: '把旁白当解说词（功能不同）。', source: 'shmeea' },
  { term: '无声', category: '声音', definition: '有意识地取消声音或制造静默，以强化情绪或对比。', criteria: '声音突然消失/长时间静默。', misuse: '把录音故障当无声设计。', source: 'zhangjing' },
  { term: '声画同步', category: '声音', definition: '声音与画面在同一时空、同一事件上严格对应。', criteria: '声源可见、时间对齐。', misuse: '把声画分离当同步。', source: 'zhangjing' },
  { term: '声画分离', category: '声音', definition: '声音与画面在时空上分离，声源不在画面内或不与画面同时。', criteria: '声源画外/时间错位。', misuse: '把声画对位当分离（对位强调意义对位）。', source: 'zhangjing' },
  { term: '声画对位', category: '声音', definition: '声音与画面在意义或情绪上形成对比、呼应的关系。', criteria: '声画内容形成反差或隐喻。', misuse: '把普通分离当对位。', source: 'zhangjing' },
  { term: '主观声音', category: '声音', definition: '从人物主观感受出发的声音（如耳鸣、心跳、幻听）。', criteria: '声音带有主观心理特征，非客观环境声。', misuse: '把画外音当主观声音（需看是否人物心理）。', source: 'shmeea' },
  { term: '客观声音', category: '声音', definition: '画面空间内客观存在、人物与观众都能听到的声音。', criteria: '声源在场景内、符合物理空间。', misuse: '把旁白当客观声音。', source: 'shmeea' },
];

export const FRAMEWORKS = [
  {
    name: '四角度分析法',
    summary: '分析一部影片的视听语言，从镜头、画面、剪辑、声音四个角度切入，再综合到风格与主题。',
    elements: ['镜头（形式/运动/长镜头/调度）', '画面（景别/角度/光色/构图）', '剪辑（经典剪辑/蒙太奇/风格化）', '声音（分类/功能/声画关系）'],
    source: 'shmeea',
  },
  {
    name: '经典剪辑体系',
    summary: '以 180 度原则、三角形机位、三镜头法与匹配剪辑为核心的连续性剪辑系统。',
    elements: ['180 度原则', '三角形机位', '三镜头法', '动作/视线/图形/声音匹配'],
    source: 'arijon',
  },
  {
    name: '苏联蒙太奇理论',
    summary: '强调镜头冲突与并置产生新意义；代表：库里肖夫效应、爱森斯坦杂耍/理性蒙太奇、普多夫金叙事蒙太奇。',
    elements: ['库里肖夫效应', '杂耍蒙太奇', '理性蒙太奇', '叙事蒙太奇'],
    source: 'bordwell',
  },
  {
    name: '长镜头与写实理论',
    summary: '以景深镜头、连续时空与场面调度保持现实完整性，与蒙太奇剪辑形成对照；分记录式、叙事性、时间长镜头。',
    elements: ['记录式长镜头', '叙事性长镜头', '时间长镜头', '景深镜头/场面调度'],
    source: 'zhangjing',
  },
  {
    name: '场面调度体系',
    summary: '人物调度与镜头调度综合组织空间，引导注意力并揭示关系与主题。',
    elements: ['人物调度', '镜头调度', '综合调度', '轴线与空间连续性'],
    source: 'arijon',
  },
  {
    name: '叙事系统三层',
    summary: '从整体质感、结构感、风格感三个层面把握影片的叙事与视听系统。',
    elements: ['整体质感', '结构感（线性/时空交错/时间淡化）', '风格感（镜头/画面/剪辑/声音风格）'],
    source: 'zhangjing',
  },
  {
    name: '视听修辞',
    summary: '用视觉隐喻、强调、渲染、劝说等修辞手段传达意义与情绪。',
    elements: ['视觉隐喻', '强调', '渲染', '劝说'],
    source: 'zhangjing',
  },
  {
    name: '视点体系',
    summary: '区分客观视点、主观视点、导演诠释视点、间接主观视点，并以其作为分镜与剪辑依据。',
    elements: ['客观视点', '主观视点', '导演诠释视点', '间接主观视点'],
    source: 'shmeea',
  },
];

/** 分析质量评分卡：用于自检、评测与答辩展示。 */
export const RUBRIC = [
  { id: 'evidence', name: '证据密度', weight: 0.25, description: '每条关键结论是否附镜号/时间码/测量值/OCR/台词等可核验证据。', anchors: '0 分=全是形容词；满分=关键结论全部有证据。' },
  { id: 'terms', name: '术语准确', weight: 0.2, description: '是否使用标准术语，且判定正确（景别/角度/光线/色彩/构图/运动/声音）。', anchors: '0 分=术语错用；满分=术语准确且判据充分。' },
  { id: 'coverage', name: '维度覆盖', weight: 0.15, description: '8 个维度是否至少覆盖 6 个，且没有明显遗漏关键维度。', anchors: '0 分=只写剧情；满分=八维完整。' },
  { id: 'depth', name: '分析深度', weight: 0.15, description: '是否从“看到什么”推进到“机制/效果/意图”，而非停留在描述。', anchors: '0 分=复述画面；满分=机制与意图清晰。' },
  { id: 'structure', name: '结构完整', weight: 0.1, description: '是否有段落定位、分镜表、视听分析、摘要、待核实等完整结构。', anchors: '0 分=散乱；满分=结构清晰可复用。' },
  { id: 'uncertainty', name: '不确定性处理', weight: 0.1, description: '可核实与推测是否分离，待核实清单是否具体。', anchors: '0 分=把猜测当事实；满分=边界清楚。' },
  { id: 'readability', name: '表达可读', weight: 0.05, description: '语言是否准确、简洁、可引用，避免空话套话。', anchors: '0 分=套话堆砌；满分=可直接进报告。' },
];

function selectTerms(keywords, limit) {
  const list = Array.isArray(keywords) ? keywords.map((item) => String(item).trim()).filter(Boolean) : [];
  if (list.length === 0) {
    const buckets = new Map();
    for (const term of TERMS) {
      if (!buckets.has(term.category)) buckets.set(term.category, []);
      buckets.get(term.category).push(term);
    }
    const picked = [];
    let round = 0;
    while (picked.length < limit) {
      let added = false;
      for (const bucket of buckets.values()) {
        if (bucket[round]) {
          picked.push(bucket[round]);
          added = true;
          if (picked.length >= limit) break;
        }
      }
      if (!added) break;
      round += 1;
    }
    return picked;
  }
  const scored = [];
  for (const term of TERMS) {
    const haystack = `${term.term}${term.category}${term.definition}${term.criteria || ''}`;
    let score = 0;
    for (const keyword of list) {
      if (haystack.includes(keyword)) score += 1;
    }
    if (score > 0) scored.push({ term, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, limit).map((item) => item.term);
  return picked.length > 0 ? picked : TERMS.slice(0, limit);
}

/** 生成注入提示词的专业规范片段（约 600–900 字，避免挤占输出预算）。 */
export function buildNormsForPrompt(options = {}) {
  const keywords = Array.isArray(options.keywords) ? options.keywords : [];
  const termLimit = Number.isFinite(options.termLimit) ? Math.min(16, Math.max(4, options.termLimit)) : 10;
  const lines = [];
  lines.push('【专业判定标准（依据张菁《影视视听语言》第三版与上海自考 07189 2026 大纲整理）】');
  for (const dim of DIMENSION_STANDARDS) {
    lines.push(`- ${dim.name}：${dim.criteria.join('；')}`);
  }
  const terms = selectTerms(keywords, termLimit);
  if (terms.length > 0) {
    lines.push('');
    lines.push('【术语判据参考（使用时须与画面证据对应）】');
    for (const term of terms) {
      lines.push(`- ${term.term}：${term.definition}${term.criteria ? `（判定：${term.criteria}）` : ''}`);
    }
  }
  lines.push('');
  lines.push(
    `【评分要点】${RUBRIC.map((item) => `${item.name}${Math.round(item.weight * 100)}%`).join('、')}；每条结论必须能落到镜头号/时间码/测量值/OCR/台词。`,
  );
  return lines.join('\n');
}

/** 生成面板「知识点速查」用的分组（沿用 extraTopics 的 section/terms 结构）。 */
export function buildNormsGroupsForPanel() {
  const dimensionGroup = {
    section: '十、专业分析规范·8 维判定标准',
    terms: DIMENSION_STANDARDS.map((dim) => ({
      term: dim.name,
      definition: `${dim.definition} 判据：${dim.criteria.join('；')}`,
      cite: `规范·${dim.source === 'arijon' ? '阿里洪' : dim.source === 'bordwell' ? 'Bordwell' : dim.source === 'shmeea' ? '上戏自考大纲' : dim.source === 'tup' ? '清华艺考参考' : '张菁教材'}`,
    })),
  };
  const byCategory = new Map();
  for (const term of TERMS) {
    const key = `十一、术语判据卡·${term.category}`;
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key).push({
      term: term.term,
      definition: `${term.definition}${term.criteria ? ` 判定：${term.criteria}` : ''}${term.misuse ? ` 易误用：${term.misuse}` : ''}`,
      cite: `规范·${term.source === 'arijon' ? '阿里洪' : term.source === 'bordwell' ? 'Bordwell' : term.source === 'shmeea' ? '上戏自考大纲' : term.source === 'tup' ? '清华艺考参考' : '张菁教材'}`,
    });
  }
  const frameworkGroup = {
    section: '十二、理论框架',
    terms: FRAMEWORKS.map((item) => ({
      term: item.name,
      definition: `${item.summary} 要素：${item.elements.join('、')}`,
      cite: `规范·${item.source === 'arijon' ? '阿里洪' : item.source === 'bordwell' ? 'Bordwell' : item.source === 'shmeea' ? '上戏自考大纲' : '张菁教材'}`,
    })),
  };
  const rubricGroup = {
    section: '十三、分析质量评分卡',
    terms: RUBRIC.map((item) => ({
      term: `${item.name}（${Math.round(item.weight * 100)}%）`,
      definition: `${item.description} ${item.anchors}`,
      cite: '规范·评分卡',
    })),
  };
  return [dimensionGroup, ...Array.from(byCategory.entries()).map(([section, terms]) => ({ section, terms })), frameworkGroup, rubricGroup];
}

export function getNormsSummary() {
  return {
    ok: true,
    sources: SOURCES,
    dimensions: DIMENSION_STANDARDS.map(({ id, name, definition, criteria, source }) => ({ id, name, definition, criteria, source })),
    termCount: TERMS.length,
    termCategories: Array.from(new Set(TERMS.map((term) => term.category))),
    frameworks: FRAMEWORKS.map(({ name, summary }) => ({ name, summary })),
    rubric: RUBRIC,
  };
}
