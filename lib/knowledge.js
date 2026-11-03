/**
 * 影视画面分析器 · 内置通用知识数据（开源版）
 *
 * 说明：本文件是插件面板 8 维分析表单与提示词框架的数据源，采用通用影视语言术语，
 * 未包含任何教材原文、页码或题库（教材笔记属第三方版权内容）。
 * 想换成自己的教材词库：按本文件结构替换即可（字段见 docs/knowledge-data.md）。
 */

export const DIMENSIONS = [
  {
    key: 'shotSize',
    label: '景别',
    note: '按被摄主体在画面中的比例与取景范围划分',
    terms: [
      { term: '景别', definition: '取景范围与被摄主体在画面中所占比例形成的画面尺度分类。', cite: '', exam: '' },
      { term: '远景', definition: '以广阔环境为主体、人物较小的景别，常用于交代空间、时间与规模。', cite: '', exam: '' },
      { term: '全景', definition: '完整呈现人物全身或场景全貌的景别，用于交代人物与环境关系。', cite: '', exam: '' },
      { term: '中景', definition: '取人物腰部以上的景别，兼顾环境与人物动作、交流关系。', cite: '', exam: '' },
      { term: '近景', definition: '取人物胸部以上的景别，突出表情与情绪，弱化环境。', cite: '', exam: '' },
      { term: '特写', definition: '人物面部或物体局部占据画面大部分的景别，强调细节与情绪。', cite: '', exam: '' },
      { term: '大特写', definition: '只取局部细节、放大到充满画面的景别，视觉冲击力强。', cite: '', exam: '' },
      { term: '景别序列', definition: '由远及近或由近及远的景别组合，用递进方式描述场景与情绪。', cite: '', exam: '' },
    ],
  },
  {
    key: 'depthFocal',
    label: '景深与焦距',
    note: '镜头光学特性与画面空间感',
    terms: [
      { term: '焦距', definition: '镜头光学中心到成像平面的距离，决定视角、透视与景深关系。', cite: '', exam: '' },
      { term: '标准镜头', definition: '视角接近人眼视觉习惯的镜头，透视自然、变形小。', cite: '', exam: '' },
      { term: '广角镜头', definition: '视角大、景深大、透视夸张的短焦镜头，适合表现空间纵深与环境。', cite: '', exam: '' },
      { term: '长焦镜头', definition: '视角小、景深浅、空间压缩感强的长焦镜头，适合突出主体。', cite: '', exam: '' },
      { term: '变焦镜头', definition: '焦距可连续变化、通过变焦改变取景范围与景别的镜头。', cite: '', exam: '' },
      { term: '景深', definition: '画面中能够清晰成像的前后空间范围。', cite: '', exam: '' },
      { term: '大景深', definition: '前景到背景都相对清晰，强调空间关系与信息量。', cite: '', exam: '' },
      { term: '浅景深', definition: '只有主体清晰、背景虚化，用于突出主体、隔离环境。', cite: '', exam: '' },
    ],
  },
  {
    key: 'anglePosition',
    label: '角度和机位',
    note: '摄影机位置与视角关系',
    terms: [
      { term: '机位', definition: '摄影机在拍摄空间中的位置，包含高度、方向与距离。', cite: '', exam: '' },
      { term: '平视', definition: '摄影机与被摄主体大致同高的视角，观感客观、平等。', cite: '', exam: '' },
      { term: '仰视', definition: '摄影机低于主体向上拍摄的视角，常表现高大、威严或压迫。', cite: '', exam: '' },
      { term: '俯视', definition: '摄影机高于主体向下拍摄的视角，常表现渺小、审视或全貌。', cite: '', exam: '' },
      { term: '正面', definition: '摄影机面对主体正面的角度，信息直接、交流感强。', cite: '', exam: '' },
      { term: '侧面', definition: '摄影机位于主体侧方的角度，强调轮廓、方向与空间关系。', cite: '', exam: '' },
      { term: '背面', definition: '摄影机从主体背后拍摄的角度，制造神秘、跟随或代入感。', cite: '', exam: '' },
      { term: '视点', definition: '叙事中观察与呈现画面的角度和立场，可分为客观视角与主观视角。', cite: '', exam: '' },
    ],
  },
  {
    key: 'lightTone',
    label: '光线和影调',
    note: '光源方向、性质与明暗基调',
    terms: [
      { term: '光位', definition: '光源相对被摄主体的方向位置，如顺光、侧光、逆光、顶光、底光。', cite: '', exam: '' },
      { term: '顺光', definition: '光源在摄影机方向，主体受光均匀、细节清楚，但立体感较弱。', cite: '', exam: '' },
      { term: '侧光', definition: '光源从侧面照射，明暗过渡明显，利于塑造体积与质感。', cite: '', exam: '' },
      { term: '逆光', definition: '光源在主体背后，可形成剪影或轮廓光，氛围感强。', cite: '', exam: '' },
      { term: '顶光', definition: '光源从上方照射，常在眼部形成阴影，带来特殊或压抑的观感。', cite: '', exam: '' },
      { term: '底光', definition: '光源从下方照射，反常的明暗分布制造诡异、紧张气氛。', cite: '', exam: '' },
      { term: '硬光', definition: '方向性强的直射光，明暗边界清晰、对比强烈。', cite: '', exam: '' },
      { term: '柔光', definition: '经过柔化的散射光，明暗过渡柔和，适合表现温和或唯美质感。', cite: '', exam: '' },
      { term: '高调', definition: '整体偏亮的影调处理，画面明快、轻盈。', cite: '', exam: '' },
      { term: '低调', definition: '整体偏暗的影调处理，画面沉重、神秘或紧张。', cite: '', exam: '' },
    ],
  },
  {
    key: 'colorPalette',
    label: '色彩色调',
    note: '色彩关系与整体色调倾向',
    terms: [
      { term: '色温', definition: '光源色的冷暖倾向，可用开尔文温度描述；影响画面整体冷暖感。', cite: '', exam: '' },
      { term: '暖色调', definition: '以红、橙、黄等色彩为主的色调，传达温暖、热烈或怀旧。', cite: '', exam: '' },
      { term: '冷色调', definition: '以蓝、青等色彩为主的色调，传达冷静、疏离或压抑。', cite: '', exam: '' },
      { term: '饱和度', definition: '色彩的鲜艳程度，低饱和度更显克制、写实，高饱和度更强烈。', cite: '', exam: '' },
      { term: '对比色', definition: '色相环上相距较远的色彩关系，对比强烈、视觉冲击力大。', cite: '', exam: '' },
      { term: '邻近色', definition: '色相环上相邻的色彩关系，搭配和谐统一。', cite: '', exam: '' },
      { term: '色彩基调', definition: '整部作品或段落的主导色彩倾向，与主题和情绪表达相关。', cite: '', exam: '' },
    ],
  },
  {
    key: 'composition',
    label: '构图',
    note: '画面内元素的组织与视觉引导',
    terms: [
      { term: '构图', definition: '在画框内安排人物、景物与线条的位置关系，形成视觉秩序。', cite: '', exam: '' },
      { term: '三分法', definition: '将画面横竖各三等分，把主体放在交叉点或分割线附近的构图方法。', cite: '', exam: '' },
      { term: '对称构图', definition: '以中轴为界左右或上下对称的构图，稳定、庄重或刻意失衡。', cite: '', exam: '' },
      { term: '前景', definition: '位于主体之前、靠近镜头的景物，用于增加层次与空间感。', cite: '', exam: '' },
      { term: '背景', definition: '主体之后的环境，交代信息并衬托主体。', cite: '', exam: '' },
      { term: '留白', definition: '画面中留出的空白区域，给视线与情绪以呼吸空间。', cite: '', exam: '' },
      { term: '视觉中心', definition: '画面中最先吸引注意力的位置或元素。', cite: '', exam: '' },
      { term: '线条', definition: '画面中由景物或运动形成的引导线，可引导视线、强化纵深。', cite: '', exam: '' },
    ],
  },
  {
    key: 'cameraMovement',
    label: '镜头运动',
    note: '摄影机运动方式与调度',
    terms: [
      { term: '固定镜头', definition: '摄影机位置与角度不变拍摄的镜头，画面稳定、客观。', cite: '', exam: '' },
      { term: '推镜头', definition: '摄影机向前移动或变焦推近，逐次突出主体与细节。', cite: '', exam: '' },
      { term: '拉镜头', definition: '摄影机后退或变焦拉远，由局部扩展到环境，常用于收束或揭示。', cite: '', exam: '' },
      { term: '摇镜头', definition: '摄影机位置不动、机身左右或上下转动拍摄。', cite: '', exam: '' },
      { term: '移镜头', definition: '摄影机位置平行移动拍摄，呈现空间层次与连续关系。', cite: '', exam: '' },
      { term: '跟镜头', definition: '摄影机跟随运动主体拍摄，保持主体在画面中的相对位置。', cite: '', exam: '' },
      { term: '升降镜头', definition: '摄影机沿垂直方向升降拍摄，改变视点高度与空间关系。', cite: '', exam: '' },
      { term: '长镜头', definition: '单镜头内持续较长时间、不剪辑的镜头，保留时空连续性与表演。', cite: '', exam: '' },
      { term: '场面调度', definition: '对人物走位、摄影机运动、空间与光线的综合设计。', cite: '', exam: '' },
    ],
  },
  {
    key: 'sound',
    label: '声音线索',
    note: '声音元素与声画关系',
    terms: [
      { term: '人声', definition: '对白、独白、旁白等人发出的声音，承担叙事与情绪表达。', cite: '', exam: '' },
      { term: '环境声', definition: '场景中持续存在的背景声音，用于建立空间真实感。', cite: '', exam: '' },
      { term: '音乐', definition: '用于渲染情绪、推进节奏或点明主题的配乐。', cite: '', exam: '' },
      { term: '音效', definition: '为动作或事件添加的效果声音，强化真实感与冲击力。', cite: '', exam: '' },
      { term: '画外音', definition: '声源不在画面内（或不在画面中可见）的声音。', cite: '', exam: '' },
      { term: '声画同步', definition: '声音与画面内容在时间上严格对应，增强可信度。', cite: '', exam: '' },
      { term: '声画对位', definition: '声音与画面内容形成对比或反讽，制造新的含义。', cite: '', exam: '' },
      { term: '静默', definition: '突然的无声处理，用于制造紧张、强调或情绪停顿。', cite: '', exam: '' },
    ],
  },
]

export const FRAMEWORK = {
  book1: {
    title: '通用影片视听分析框架（五步）',
    steps: [
      { name: '定位', detail: '明确影片的类型、年代、作者与题材，确定分析对象与问题意识。', cite: '' },
      { name: '结构', detail: '分析叙事结构、场景结构与时空结构，梳理段落功能。', cite: '' },
      { name: '视觉设计', detail: '考察美术、场景、服装、光线、色彩的总体设计。', cite: '' },
      { name: '语言拆解', detail: '按景别、角度、运动、剪辑、声音逐项拆解段落，说明手段、动机与效果。', cite: '' },
      { name: '风格与主题', detail: '归纳整体形式风格，说明形式如何服务主题，做到就语言谈语言。', cite: '' },
    ],
  },
  book2: {
    title: '场面调度与剪辑规则框架',
    rules: [
      { name: '关系线', detail: '先确定人物之间的关系线（轴线），保持空间方向的一致性。', cite: '' },
      { name: '三角形机位', detail: '在关系线一侧用三角形布机位拍摄对话，可通过中性镜头过渡越轴。', cite: '' },
      { name: '中性方向', detail: '需要改变方向时，插入正面/背面或运动中的中性镜头，避免跳轴。', cite: '' },
      { name: '运动剪辑', detail: '在动作的切换点剪辑，保持动作连贯与方向感。', cite: '' },
      { name: '分句法', detail: '用一系列镜头构成叙事“句子”，注意镜头间的逻辑与节奏关系。', cite: '' },
    ],
  },
}

export const TRAINING = {
  noun: [],
  short: [],
  essay: [],
  filmAnalysis: { template: [], prompts: [] },
  shotScript: {
    columns: ['镜号', '时间码', '景别', '角度和机位', '镜头运动', '画面内容', '声音', '时长'],
    grading: [],
    prompts: [],
  },
}

export const FILMS = []
