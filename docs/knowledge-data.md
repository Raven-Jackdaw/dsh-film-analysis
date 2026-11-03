# 知识数据格式（lib/knowledge.js）

面板的 8 维表单、提示词框架来自 `lib/knowledge.js`。本仓库内置的是从作者学习笔记整理的**知识点总结**（术语/定义/两书框架/题库/片例索引）；教材原文与完整笔记不随包分发。你可以按本文件结构替换成自己的词库（注意版权，别把受版权保护的原文公开发布）。

## 导出结构

```js
export const DIMENSIONS = [
  {
    key: 'shotSize',        // 固定 key，见下表
    label: '景别',           // 面板显示名
    note: '按取景范围划分',   // 可选提示
    terms: [
      { term: '景别', definition: '……', cite: '张1·印刷页10–22', exam: '名词解释' },
    ],
  },
  // 严格 8 个维度，顺序固定
]

export const FRAMEWORK = {
  book1: { title: '影片分析框架', steps: [{ name, detail, cite }] },
  book2: { title: '调度与剪辑框架', rules: [{ name, detail, cite }] },
}

export const TRAINING = {
  noun: [{ q: '题目', points: '参考答案要点', cite: '' }],
  short: [{ q, points, cite }],
  essay: [{ q, outline, cite }],
  filmAnalysis: { template: ['分析模板段落'], prompts: ['练习题'] },
  shotScript: { columns: ['镜号','时间码','…'], grading: ['评分点'], prompts: ['分镜题'] },
}

export const FILMS = [{ title: '片名', use: '用途说明', cite: '' }]
```

固定 8 个维度 key（顺序不可变）：

| key | label |
|---|---|
| `shotSize` | 景别 |
| `depthFocal` | 景深与焦距 |
| `anglePosition` | 角度和机位 |
| `lightTone` | 光线和影调 |
| `colorPalette` | 色彩色调 |
| `composition` | 构图 |
| `cameraMovement` | 镜头运动 |
| `sound` | 声音线索 |

## 最小可用示例

```js
export const DIMENSIONS = [
  { key: 'shotSize', label: '景别', terms: [{ term: '特写', definition: '突出细节。', cite: '', exam: '' }] },
  { key: 'depthFocal', label: '景深与焦距', terms: [] },
  { key: 'anglePosition', label: '角度和机位', terms: [] },
  { key: 'lightTone', label: '光线和影调', terms: [] },
  { key: 'colorPalette', label: '色彩色调', terms: [] },
  { key: 'composition', label: '构图', terms: [] },
  { key: 'cameraMovement', label: '镜头运动', terms: [] },
  { key: 'sound', label: '声音线索', terms: [] },
]
export const FRAMEWORK = { book1: { title: '', steps: [] }, book2: { title: '', rules: [] } }
export const TRAINING = { noun: [], short: [], essay: [], filmAnalysis: { template: [], prompts: [] }, shotScript: { columns: [], grading: [], prompts: [] } }
export const FILMS = []
```

## 注意

- 该文件必须导出上述 4 个常量（缺省会报 `knowledge-missing`）。
- 修改后重新安装/重载插件才会生效（`plugin_manager` remove → install）。
- 不要提交受版权保护的教材原文、整套题库或页码索引——用你自己的归纳与公开通用术语。
