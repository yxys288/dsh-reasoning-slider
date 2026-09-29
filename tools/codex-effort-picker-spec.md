# Codex 推理强度选择器 · 像素级调研规范

> 目标读者：实现 `dsh-reasoning-slider` 两级改造的人。读完应当**不需要再去看截图、也不需要再猜**。
> 证据优先级：本机参考截图 > 联网资料。冲突时以截图为准，并在文中标注冲突。
> 调研者：teammate `codex-recon`（只读调研，未改动任何产品代码）。

---

## 0. 一句话结论

参考图里的 light / dark **不是同一个控件的两种悬停态，而是两个不同产品里两个不同控件**：

| | **light 图** | **dark 图** |
|---|---|---|
| 是什么 | **Codex App 的 Advanced「power slider」**（模型选择器里的快捷档位条） | **ChatGPT 桌面端的「Thinking effort」** 选择器 |
| 一级胶囊 | `5.6 Sol Extra High ⌄`（模型名 **深色** + 强度名 **灰色**） | `Thinking effort ⌄`（单一灰色通用标签，**不含模型名**） |
| 二级面板第一行 | `Faster` … `Smarter`（左右轴标，贴着轨道两端） | `Instant ›`（居中 + 右向 chevron = 下钻入口） |
| 面板宽 | 267px ≈ **等于 trigger 宽**（268px） | 337px，**远大于** trigger 宽（183px） |
| 刻度数 | **6** | **5** |
| 轨道高 / 圆钮 | 29px / ⌀37px（比值 1.28） | 36px / ⌀40px（比值 1.11） |

用户要的「一级显示模型名 + 推理强度」，是 **light（Codex）的一级**；用户要的「点击后出现模型名和强度滑块」，是 **dark（ChatGPT）的面板第一行**。本规范给出的落地方案 = **Codex 的一级 + ChatGPT 的面板结构**，并逐条说明哪些 Codex 细节不该照搬（见 §8.5）。

**关键外部佐证**：light 图的一级文案 `5.6 Sol Extra High` 与 openai/codex issue #31968 描述的 Codex App「Advanced power slider」的一档**逐字吻合**，且该 slider 的 preset 序列恰好 **6 档**——与 light 图数出来的 6 个刻度点一致。
（<https://github.com/openai/codex/issues/31968>、<https://github.com/openai/codex/issues/32665>）

---

## 1. 证据与方法

### 1.1 证据清单

| 证据 | 路径 | 说明 |
|---|---|---|
| light 参考图 | `dist/ui-preview/reasoning-slider/reference-codex-slider-light.png` | 996×563 |
| dark 参考图 | `dist/ui-preview/reasoning-slider/reference-codex-slider-dark.png` | 1370×519 |
| 裁剪放大图 | `dist/ui-preview/reasoning-slider/recon/*.png` | 见 §11 清单，每张标注源坐标与放大倍数 |
| 解码/裁剪脚本 | `dist/ui-preview/reasoning-slider/recon/pngtool.mjs` | 零依赖 PNG 解码（node:zlib）+ 最近邻放大，可复跑 |

### 1.2 方法

自写 PNG 解码器（支持 color type 0/2/3/4/6，bit depth 8，非隔行）→ 提取 RGBA → 逐像素扫描得到 run-length、列占用、边界轮廓、颜色直方图 → 裁剪 + 最近邻整数倍放大落盘 → **用图像查看器逐张肉眼复核**。文中所有坐标都是原图像素坐标；测量值含 ±1px 抗锯齿误差。

### 1.3 必须记住的两条测量学限制

1. **两张图的 device pixel ratio 未知**，因此绝对像素不能直接照搬。凡是可以的，本文同时给出**比值**（如 圆钮/轨道高）。
2. **light 图上有一层人为叠加的点击指示**：一个纯黑圆环（bbox x 539..616, y 423..500，直径 ≈78px、环宽 ≈2px）+ 一个手型光标图形（约 x 565..590, y 459..471）。它**不是控件的一部分**——dark 图上没有，且圆环恰好套住圆钮、光标压在圆钮上，是录屏/标注软件的产物。分析圆钮时已把这块排除，见 `light-07-thumb-12x.png`。

---

## 2. Q1 · 一级控件的完整解剖

### 2.1 light 图（Codex power slider 的一级胶囊）

- 图：`recon/light-01-pill-4x.png`（源 (378,492,296,52)，4×）
- 图：`recon/light-11-pill-text-twoTone-10x.png`（源 (452,506,144,26)，10×）

| 项 | 实测值 | 证据 |
|---|---|---|
| 外框 | x **390..658**（宽 **268**），y **501..533**（高 **33**） | 行 y=520 run-length；列 x=500 竖直 run |
| 圆角 | 完整胶囊，r = 高/2 ≈ **16.5** | 行 y=505/520/530 的左边界内缩量与 r=16.5 的圆弧吻合（dy=12 时预测内缩 5.2px，实测 ≈4px 含 AA） |
| 背景 | **`#efedf0`**（带一点紫调的浅灰，不是纯中性灰） | (400,520)/(500,530)/(650,520) 三点采样一致 |
| 边框/阴影 | **无** | x=390 与 x=659 外即是页面 `#fdfdfd` / `#f3f3f3`，无暗环 |
| 文本 | `5.6 Sol Extra High`，x **458..587** | 列占用（y 508..530，灰度<205）分组 |
| ↳ 字形高 | cap height **12px**（`5` 的 bbox y 512..523）→ 约 16–17px 字号 | bboxWhere 深色像素 |
| ↳ **双色** | `5.6 Sol` = 深（最暗 26–48 ≈ **#2b2b2d**）；`Extra High` = 灰（最暗 127–162 ≈ **#85858a**） | 逐列最暗值扫描（原始数据见下） |
| ↳ 对齐 | **居中**：文本块中心 522.5 vs 胶囊中心 524 | 计算 |
| 箭头 | x **632..642**（宽 11，高 ≈6），距胶囊右缘 **16px** | 列占用最后一组 + `light-09` |
| ↳ 形状 | **细描边 chevron-down（V 形）**，stroke ≈2px，**不是实心三角 `▾`** | `light-09-pill-caret-12x.png` |
| ↳ 颜色 | ≈ **#8a8a8e**（与 `Extra High` 同级的灰，不是更浅的 caption 色） | 最暗值 138.7 |
| 悬停态 | **无证据**（单帧截图） | — |

逐列最暗灰度（原图 y 508..530，x 455..590，数值越小越黑）——两段的分界线一目了然：

```
458:192 459:48 460:58 461:88 462:92 463:70 464:64 465:60 466:192   <- "5.6"
468:141 469:46 470:167                                           <- "."
472:139 473:26 474:64 475:67 476:87 477:81 478:53 479:51 480:137   <- "6"
486:188 487:52 488:54 489:49 490:67 491:81 492:48 493:46 494:87   <- "S"
496:122 497:35 498:55 499:76 500:70 501:57 502:53 503:60 505:185 506:50 507:162  <- "ol"
--- 分界 ---
514:195 515:133 516:148 517:156 518:155 519:154 520:156 521:198   <- "E"
523:189 524:146 525:152 526:127 527:152 528:148 529:183          <- "x"
531:173 532:135 533:138 534:154 537:178 538:132 539:162 540:161 541:174
543:139 544:141 545:158 546:155 547:162 548:127 549:175          <- "ra"
556:154 557:138 558:160 559:161 560:161 561:161 562:162 563:145 564:145  <- "H"
567:191 568:148 571:148 572:142 573:149 574:149 575:156 576:154 577:132 578:185
581:134 582:158 583:176 584:158 585:160 586:143 587:180          <- "igh"
```

> **结论（置信度 高）**：一级胶囊 = `⟨模型名⟩ ⟨强度名⟩ ⌄`，模型名用主文本色、强度名用次级灰，文本整体居中，chevron 绝对贴在右侧 16px 处。它是**「当前 model+effort 组合」的只读摘要 + 面板开关**，不是可拖动的控件。

### 2.2 dark 图（ChatGPT「Thinking effort」的一级胶囊）

- 图：`recon/dark-01-pill-4x.png`（源 (866,228,300,60)，4×）

| 项 | 实测值 | 证据 |
|---|---|---|
| 外框 | x **877..1059**（宽 **183**），y **238..279**（高 **42**） | `#3b3b3b` 精确色 bbox + 行 y=250 |
| 父容器（整个输入框） | `#2a2a2a`，y 226..291 | 列 x=890 |
| 胶囊背景 | **`#3b3b3b`**（比容器亮一档） | 采样 |
| 圆角 | 完整胶囊，r ≈ **21** | 行边界轮廓 |
| 文本 | `Thinking effort`，x **891..1016**（宽 126），**左对齐**（左内边距 14） | 列占用分组 |
| ↳ 字形高 | cap ≈ **15–16px**（`I` 的 bbox y 321..335 = 15px @ `Instant`，同一字号） | 列 x=935 竖直 run |
| ↳ 颜色 | **单色** `#9c9c9c`（≈ rgba(255,255,255,.5) over #3b3b3b） | 最亮值直方图 |
| 箭头 | x **1027..1039**（宽 13），距文本 11px，距胶囊右缘 **20px**；**细描边 chevron-down**，同色 | 列占用 + `dark-11-pill-caret-12x.png` |
| 悬停态 | **无证据** | — |

> **结论（置信度 高）**：dark 的一级**不含模型名**，是一个通用触发器文案。它和 light 的一级是**两种不同的设计**，不是同一控件的两种状态——胶囊高度（42 vs 33）、内边距（14/20 vs 68/16）、对齐方式（左对齐 vs 居中）、文本色数（单色 vs 双色）全都不同。

### 2.3 对本项目最重要的三条

1. **文本内容与顺序**：`模型名` → 空格 → `强度名`。强度名是**模型名的后缀**，不是独立徽章、不是另一颗胶囊。
2. **两段用颜色而不是分隔符区分**（Codex 只用一个普通空格）。DSH 里中文档位名（低/中/高）与模型名之间**不需要** `·` 或竖线。
3. **箭头是细描边 chevron 图标，不是 `▾` 字符**。现有实现用的是 `'▾'` 文本字形——这是与参考图的一个明确偏差，建议换成内联 SVG（或 CSS 画的两根 2px 斜线）。

---

## 3. Q2 · 二级面板的完整解剖

### 3.1 light 图

- 图：`recon/light-02-panel-3x.png`（源 (380,382,292,118)，3×）

| 项 | 实测值 | 证据 |
|---|---|---|
| 外框 | x **391..657**（宽 **267**），y **389..489**（高 **100**） | 逐行扫描近白像素的左右边界 |
| 圆角 | r ≈ **14**（由 dy=3→内缩5、dy=5→内缩3 反解） | 逐行边界轮廓 |
| 背景 | **`#fdfbfe`**（上）→ **`#fdfdfd`**（下），实质「近纯白」 | 多点采样 |
| 边框 | **无**（只有阴影） | 行 y=400：x=389 `#e6e6e6`、x=658 `#e2e2e2` 是阴影不是边框 |
| 阴影 | 向下偏 1–2px、模糊 ≈10px；在 `#f2f2f2` 上最暗到 **`#d8d8d8`**（≈12% 黑） | 列 x=520 y 489..499 梯度 |
| **位置** | 在胶囊**正上方**；**水平范围与胶囊几乎完全重合**（面板 391..657 vs 胶囊 390..658） | 见 §2.1 |
| 与胶囊的间距 | 面板底 489 → 胶囊顶 501 = **12px** | `light-12-panel-to-pill-gap-8x.png` |
| 内边距 | 左右 **14.5**（轨道 404.5..643.5），上 ≈18，下 ≈18.5 | 计算 |
| **宽度来源** | 面板宽 267 ≈ 胶囊宽 268 ⇒ **等于 trigger 宽度**（轨道宽 = 268 − 2×14.5 = 239） | 见 §10 未知项 #5 |

内部行结构（从上到下）：

| 行 | 内容 | 位置 | 字号/颜色 | 对齐 |
|---|---|---|---|---|
| 1 | `Faster` … `Smarter` | `Faster` x 406..452；`Smarter` x 570..643；cap y 407..418（12px） | `#85858a` | **左标齐轨道左端**（406 vs 404.5）、**右标齐轨道右端**（643 vs 643.5），即 `justify-content: space-between` |
| 2 | 滑块 | 轨道 x 404.5..643.5，y 441.5..470 | 见 §6 | 占满内容宽 |
| 分隔线 | **无** | 列 x=420 从 y 391 到 432 全是面板底色 | — |

行距：`Faster` 基线 418 → 轨道顶 441.5 = **23.5px**；面板顶 389 → cap 顶 407 = **18px**。

### 3.2 dark 图

- 图：`recon/dark-02-panel-3x.png`（源 (786,286,364,142)，3×）
- 图：`recon/dark-03-panel-header-8x.png`（源 (918,310,150,34)，8×）

| 项 | 实测值 | 证据 |
|---|---|---|
| 外框 | x **800..1136**（宽 **337**），y **293.5..420**（高 **127**） | 逐行 `#2a2a2a` 首个 x |
| 圆角 | r ≈ **22**（由 dy=6.5→内缩7、dy=16.5→内缩2 反解） | 逐行边界轮廓 + `dark-13-panel-corner-8x.png` |
| 背景 | **`#2a2a2a`**（与输入框容器同色！） | 采样 |
| 边框 | **1px `#333333`**（比底色亮一档的细环） | 行 y=350：x=799 `#333333`、x=1136 `#333333` |
| 阴影 | 向外 4–12px，最暗 `#161616` / `#171717`（比页面 `#181818` 只暗 1 级，**几乎不可见**） | 列 x=960 y 420..431 |
| **位置** | 在胶囊**正下方**（胶囊底 279 → 面板顶 293.5，间距 **14.5px**） | — |
| **宽度来源** | 337px，**与 trigger（183px）无关** | 计算 |
| 内边距 | 左右 **18–19**（轨道 818..1117），上（到 cap 顶）**27.5**，下 **19** | 计算 |

内部行结构：

| 行 | 内容 | 位置 | 字号/颜色 | 对齐 |
|---|---|---|---|---|
| 1 | `Instant ›` | `Instant` x 933..997（宽 65），cap y 321..335（**15px**，粗体）；`›` x 1011..1016（宽 6、高 11、stroke ≈2px），距文本 **14px** | 文本 **纯白 #ffffff**；chevron **#e4e4e4** | **居中**：文本中心 965 vs 内容中心 967.5；把 chevron 一起算则中心 974.5（偏右 6.5）。**「文本居中、chevron 在其右」是更贴合的解释** |
| 2 | 滑块 | 轨道 x 818..1117（宽 300），y 366..401.5（高 36） | 见 §6 | 占满内容宽 |
| 分隔线 | **无** | 列 x=1000 从 y 294 到 365 是连续 `#2a2a2a` | — |

行距：`Instant` 基线 335 → 轨道顶 366 = **31px**。

### 3.3 二级面板的共性（可直接照搬的部分）

1. **面板永远贴在 trigger 的垂直相邻侧，间距 12–14.5px**（light 12、dark 14.5）。
2. **面板内的滑块横向占满「面板宽 − 左右内边距」**，不居中留白。
3. **两行结构**：上面一行是「文字/入口」，下面一行是滑块；**没有分隔线**。
4. **面板圆角 ≈ 0.14–0.17 × 面板高**（14/100、22/127），接近但不等于 trigger 的胶囊半径（16.5 / 21）。
5. **面板底色与 trigger 的关系**：light 面板比触发器更亮（近白 vs `#efedf0`）；dark 面板与容器同色（`#2a2a2a` vs 触发器 `#3b3b3b`，即**比触发器更暗**）。→ 结论：**面板用「浮层」底色，触发器用「控件」底色，两者不要求同色**。

---

## 4. Q3 · 面板里那行居中带 `›` 的文字是什么

**判定：它是「当前模型（或模型模式）」的行，`›` 表示点进去会换内容（下钻到模型列表）。置信度：中。**

依据：

1. **它出现在 dark（ChatGPT）那一版，而 dark 的一级胶囊里没有模型名**（只有 `Thinking effort`）。面板必须自己补上「现在用的是哪个模型」这个信息——否则用户完全看不到当前模型。这是「必要性」论证。
2. **`›`（chevron-right）与一级的 `⌄`（chevron-down）是同一套图标的两个方向**，语义标准：`⌄` = 展开当前层，`›` = 进入下一层。所以它不是一个普通标签，是一个**下钻入口**。
3. **反证：它不可能是「当前强度名」**。dark 的圆钮精确落在 5 个刻度中的 **index 3**（x=1032.5，与 `838 + 3×65 = 1033` 吻合到 0.5px）。若这行是当前强度名，它应该是从左数第 4 档的名字，而 `Instant` 无论如何都读作最轻的一档。**（这条把「强度名」假设基本排除，置信度 中高。）**
4. **子菜单里应该是什么**：模型列表（含 ChatGPT 的 Instant / Thinking / Pro 之类的模式或模型）。映射到 DSH = **现有的「按 Provider 分组的模型列表」**，即当前 `.drs-menu` 那套 `role=menu` + `role=menuitemradio` 的 DOM 可以原样复用，只是从「一级点击后直接出现」变成「二级面板里点模型行后出现」。

> **诚实说明**：我没能排除「它是当前选中的 *preset/combo* 名」这一读法（例如 `Instant` 在 ChatGPT 里既是模型也是模式）。但**两种读法在 DSH 上的落点是同一个**——一行「当前选择的名字 + 下钻箭头 → 打开模型列表」。所以实现者不必等这个歧义解决。

---

## 5. Q4 · `Faster` / `Smarter` 轴标——必须解决的疑点

### 判定

> **light 有、dark 无，不是因为「悬停/拖动才出现」，而是因为两张图来自两个不同产品里的两个不同控件。**
> **置信度：高**（判定「两个不同控件」）；**中**（判定「在 light 那版里是常驻」）。

### 依据（逐条可核对）

| # | 事实 | 支持的假设 |
|---|---|---|
| 1 | 两张图的**刻度数不同**：light 6 个（x ≈ 420 / 462 / 502.5 / 542 / 585 / 628.5），dark 5 个（x = 837.5 / 902.5 / 967.5 / 1032.5 / 1098.5） | 不同控件（同一控件的悬停态不会改变 stop 数） |
| 2 | 面板宽 vs trigger 宽：light **267 vs 268**（相等），dark **337 vs 183**（1.84×） | 不同控件（宽度策略完全不同） |
| 3 | 轨道高：light **29**，dark **36**；圆钮/轨道 = **1.28** vs **1.11** | 不同控件（不是等比缩放，因为缩放会同时缩放圆钮与轨道） |
| 4 | 一级胶囊文本：light **双色 `5.6 Sol` + `Extra High`**；dark **单色 `Thinking effort`** | 不同控件（悬停不会改一级胶囊的文案结构） |
| 5 | 外部资料：openai/codex **issue #31968** 逐字描述 Codex App 的「Advanced power slider」，其示例值就是 **`5.6 Sol Extra High`**，且 preset 序列为 `5.6 Terra+low → 5.6 Sol+low → +medium → +high → +xhigh → +ultra`，**共 6 档** | light = Codex power slider（6 刻度 ↔ 6 preset，数字对得上） |
| 6 | 外部资料：ChatGPT 的这个控件公开名称就是 **「Thinking effort」**（BleepingComputer 报道 / learn.chatgpt.com） | dark = ChatGPT 的 Thinking effort 选择器 |
| 7 | light 图的轴标与轨道**严格左右对齐**（406↔404.5、643↔643.5），是两个贴着布局边界的元素，不像跟随指针的浮动提示 | light 里是**布局元素**（倾向常驻） |
| 8 | light 图**确实处于交互中**（有黑色点击指示环 + 手型光标压在圆钮上） | **不能排除**「仅悬停/拖动时出现」 |

第 7、8 条互相拉扯：第 8 条说明**这张图不能用来证明「常驻」**，第 7 条说明**它的几何形态像常驻布局**。所以「light 那版里是否常驻」只能判到「中」。

### 推荐落地默认值

| 决策 | 推荐 | 理由 |
|---|---|---|
| DSH 的面板里要不要轴标 | **要，且常驻**（面板一打开就显示） | ① 这是 Codex power slider 最可识别的特征，用户要的就是「和 codex 一样」；② 面板是浮层，纵向空间绰绰有余；③ 常驻比悬停实现简单、无跳变、对键盘/触屏用户也可见 |
| 文案 | **「更快」…「更强」** | 与中文界面一致；对应 Faster / Smarter。**不要**照搬英文 |
| 位置/字号 | 滑块**上方**一行，`display:flex; justify-content:space-between`，11px，`--dsw-alias-label-tertiary`，与轨道间距 6px | 忠于参考（左标齐轨道左端、右标齐轨道右端） |
| 可访问性 | `aria-hidden="true"` | 它是视觉说明；语义由滑块的 `aria-label="推理强度"` + `aria-valuetext` 承担 |

---

## 6. Q5 · 滑块的几何与交互

### 6.1 几何（两图对照）

| 量 | light | dark | 比值 light/dark |
|---|---|---|---|
| 轨道 x 范围 | 404.5 .. 643.5 | 818 .. 1117 | — |
| 轨道宽 W | **239** | **300** | 0.80 |
| 轨道高 H | **29** | **36** | 0.81 |
| 轨道圆角 | 完整胶囊（H/2 = 14.5） | 完整胶囊（H/2 = 18） | — |
| 填充色 | **#298ffe** | **#3a83f7** | — |
| 空轨色 | **#e5e2e6** | **#404040** | — |
| 空轨内高光 | 无 | 顶边 1px **#464646**（比底色亮） | — |
| 圆钮直径 D | **≈37**（x 567..603） | **40**（x 1013..1052） | 0.93 |
| 圆钮色 | **纯白 #ffffff**（两套主题都是白） | **纯白 #ffffff** | — |
| 圆钮溢出 | 上下各 **≈4px**（D/H = 1.28） | 上下各 **2px**（D/H = 1.11） | — |
| 圆钮阴影 | 可见：右侧/下方 ≈ #dedbdf / #dddddf，极柔 | 可见：轻微，一圈柔和暗边 | — |
| 刻度点数 | **6** | **5** | — |
| 刻度点中心 x | 420, 462, 502.5, 542, (585 被圆钮盖住), 628.5 | 837.5, 902.5, 967.5, (1032.5 被圆钮盖住), 1098.5 | — |
| 刻度点直径 | **6–7px** | **6px** | — |
| 点 / 轨道高 | 0.22 | 0.17 | — |
| 点垂直位置 | **轨道竖直中心**（点 y 453..458，轨道中心 455.5） | **轨道竖直中心**（点 y 381..386，轨道中心 383.5） | — |
| 填充段上的点色 | **#66aefd** = 白 **28%** over #298ffe | **#75a8f9** = 白 **29%** over #3a83f7 | — |
| 空轨上的点色 | **#a9a9ac** = 黑 **26%** over #e5e2e6 | **#6f6f6f** = 白 **25%** over #404040 | — |
| 当前档 index | **4** of 0..5 | **3** of 0..4 | — |

**刻度点位置的公式**（dark 精确吻合，light 差 ≈3px，属可接受的实现差异）：

```
dotCenter(i) = trackLeft + D/2 + i * (W - D) / (n - 1)

dark  : 818 + 20 + i*65        -> 838, 903, 968, 1033, 1098   与实测 837.5/902.5/967.5/1032.5/1098.5 吻合
light : 404.5 + 18.5 + i*40.2   -> 423, 463, 503, 544, 584, 624  实测 420/462/502.5/542/.../628.5（偏差 <=4px）
```

> **推荐**：采用 **dark 的公式**（也就是现有 `stopCenter()` 已经在用的公式），它干净、且与原生 `<input type=range>` 的圆钮行程严格一致。light 的偏离量（≤4px）不足以支撑引入第二套公式。

### 6.2 交互

| 问题 | 参考图的证据 | 判定 / 置信度 |
|---|---|---|
| 点击轨道是否跳档 | 静态图无法判定 | **无证据**；建议**保留现有行为**（点击即跳档），因为几何与原生 range 完全一致（圆钮行程 = W − D） |
| 拖动是否实时预览 | 静态图无法判定 | **无证据**；建议保留（拖动实时移动圆钮 + 填充） |
| 松手才提交？ | 静态图无法判定 | **无证据**；建议保留（松手 / 键盘抬起 / 失焦提交），这已经是现有实现且有测试钉住 |
| 刻度数是否等于档位数 | light 6 个点 ↔ Codex 的 6 个 **(模型+强度) preset**；dark 5 个点 ↔ ChatGPT 的 5 档强度 | **是。但语义不同**：Codex 的 stop 是**跨模型 preset**（滑动会换模型），ChatGPT 的 stop 是**同一模型的强度档**。**DSH 属于后者**。置信度 高 |
| 一级胶囊上是否也暗示档位 | light：胶囊上只有文字 + chevron，**没有任何图形刻度 / 进度条**；dark：同样 | **没有。** 置信度 高（就这两张图而言） |

> **对 DSH 的直接含义**：**不要**在一级胶囊上画迷你进度条或迷你刻度。一级只承载「文字」。滑块外观上唯一的「当前值」指示器就是圆钮位置与那颗被占据的刻度点。

---

## 7. Q6 · 行为与可达性

| 问题 | 证据 | 判定 / 置信度 |
|---|---|---|
| 点击一级打开面板 | 一级有 `⌄`、面板存在且与之严格对齐 | **是**。置信度 高 |
| **面板方向** | light 的输入框在窗口**底部** → 面板**朝上**；dark 的输入框在窗口**中部** → 面板**朝下** | **按可用空间翻转，不是固定朝上**。置信度 **高**（本次调研里最容易被忽略、但证据最硬的一条） |
| 面板内点击模型行会发生什么 | `›` 的语义 + dark 一级不含模型名 | **下钻到模型列表**（内容替换），而不是把滑块挤掉。置信度 中 |
| Esc | 静态图无证据 | 建议：面板内 Esc = 关面板；模型列表内 Esc = 退回面板。置信度 低（沿用惯例） |
| 点击外部 | 静态图无证据 | 建议：关闭。置信度 低（现有实现已有） |
| 方向键 | 静态图无证据 | 建议：滑块获得焦点时保留原生 ← / →；面板内 ↑ / ↓ 在「模型行」与「滑块」之间移动焦点。置信度 低 |
| 打开时焦点落在哪里 | 静态图无证据 | 建议：落在**面板容器**（`role="dialog"` + `tabindex="-1"`），保证 Esc 一定可达；模型列表打开时焦点落第一个选项。置信度 低 |

> 方向翻转这一条是**从截图直接看出来的**，必须实现（现有代码 `y = rect.top - 8 - height` 是硬编码朝上，当 seat 靠近视口顶部时面板会被 clamp 到离谱的位置）。

---

## 8. Q7 · DSH 落地方案（最重要）

### 8.1 映射表

| Codex / ChatGPT 概念 | DSH 对应物 | 说明 |
|---|---|---|
| 一级胶囊 `5.6 Sol Extra High` | `⟨当前模型 name⟩ ⟨当前档位 name⟩` | 模型名来自 `currentModel.name`（已有）；档位名来自 `levels[index].label`（已有 `levelLabel`） |
| 一级胶囊 `⌄` | 同一个 chevron | 换成细描边图标 |
| 面板第一行 `Instant ›` | **`模型名 ›` 行** | 点击 → 现有模型列表（第三级）。**这是用户明确要求的** |
| 面板第一行 `Faster / Smarter` | **`更快 / 更强` 轴标** | 面板顶部一行，11px，`space-between` |
| 滑块 stop（Codex 的跨模型 preset） | **该模型 `reasoning.efforts` 的每一档**（现在 3–5 档） | **关键差异**：DSH 拖动滑块**不换模型** |
| adapter 可能不声明 defaultEffort | 左端补一个 `{effort: undefined, label: '默认'}` 档 | 现有逻辑保持不变 |
| 面板宽度 | **固定宽**（推荐 264px），**不跟 trigger 同宽** | 见 §8.5 |
| 面板方向 | 优先朝上，空间不足则朝下 | 见 §7 |

### 8.2 推荐的 DOM 结构

```html
<div class="drs-root">                      <!-- position:relative; display:flex; align-items:center -->
  <!-- ── 一级：模型名 + 强度名 + chevron ───────────────────────── -->
  <button class="drs-trigger"
          type="button"
          aria-haspopup="dialog" aria-expanded={open}
          aria-controls={open ? id + '-panel' : undefined}
          disabled={locked}
          title={modelLabel + ' · ' + levelLabel + (atTopLevel ? ' — ' + topHint : '')}>
    <span class="drs-trigger-model">{modelLabel}</span>     <!-- 主色，可省略号 -->
    <span class="drs-trigger-effort">{levelLabel}</span>    <!-- 次级灰；无 levels 时不渲染 -->
    <svg class="drs-caret" aria-hidden="true" viewBox="0 0 12 12">…chevron-down…</svg>
  </button>

  <!-- ── 二级：面板（view === 'panel' 时渲染） ─────────────────── -->
  <div class="drs-panel" id={id + '-panel'} role="dialog" aria-label="模型与推理强度"
       tabindex="-1" ref={panelRef} style={{left: menuPos.left, top: menuPos.top}}>
    <!-- 2.1 模型行：下钻到模型列表 -->
    <button class="drs-model-row" type="button" onClick={openModelList}>
      <span class="drs-model-row-name">{modelLabel}</span>
      <svg class="drs-chevron-right" aria-hidden="true" viewBox="0 0 8 12">…chevron-right…</svg>
    </button>

    <!-- 2.2 轴标 + 滑块（仅 levels.length > 1 时） -->
    <div class="drs-effort-block">
      <div class="drs-axis" aria-hidden="true"><span>更快</span><span>更强</span></div>
      <div class="drs-slider">        <!-- 现有 .drs-track-wrap + .drs-flow + input[type=range] 原样搬进来 -->
        …（内部 DOM 不变）
      </div>
    </div>

    <!-- 2.3 只有一档时：一句静态说明，避免空面板 -->
    <!-- <p class="drs-single">该模型只有一个推理档位</p> -->
  </div>

  <!-- ── 三级：模型列表（现有 .drs-menu 原样复用，改由模型行触发） ── -->
  <div class="drs-menu" role="menu">…现有 groups / options 结构不变…</div>

  <div class="drs-notice" role="status">{notice}</div>
  <div data-drs-debug={diagnostics} style="display:none"></div>
</div>
```

**状态机**（把现有的布尔 `open` 换成三态）：

```
view = 'closed' | 'panel' | 'models'

trigger click      : closed <-> panel（panel -> closed；closed -> panel 并 load()）
model row click    : panel -> models
option click       : models -> closed（成功后；失败留在 models 并给 notice）
Esc                : models -> panel ; panel -> closed
outside mousedown  : 任意 -> closed
```

### 8.3 推荐尺寸（DSH 尺度，28px 触发器所在的那一行）

| 元素 | 值 | 依据 |
|---|---|---|
| trigger 高 | 28px（不变） | 现状；DSH 输入框一行 |
| trigger 内边距 | `0 8px`；`gap: 4px` | 现状 |
| trigger 字号 | 13px / 500（模型段）；13px / 500（强度段） | 现状；两段用颜色区分，不改字号 |
| 模型段颜色 | `--dsw-alias-label-primary` | 参考图：模型名最深 |
| 强度段颜色 | `--dsw-alias-label-tertiary` | 参考图：强度名 ≈ 次级灰 |
| chevron | 10×10 内联 SVG，stroke 1.5px，`--dsw-alias-label-caption` | 参考：细描边、与强度名同色系 |
| trigger 最大宽 | `min(220px, 32cqw)`（不变） | 现状；两段都要 `text-overflow:ellipsis`（**强度段优先不截断**：给它 `flex:none`，把省略留给模型段） |
| **面板宽** | **264px**（`min(264px, 100vw - 32px)`） | 取 light 267 与「DSH 输入框窄」之间的折中；定宽才能让轨道宽成为编译期常量 |
| 面板内边距 | `12px 14px 14px` | 参考：左右 14.5 / 18，上 18 / 27.5，下 18.5 / 19 |
| 面板圆角 | **16px** | 参考：14（light）/ 22（dark），取中 |
| 面板背景 | `--dsw-specific-menu`（复用现有菜单 token） | 参考：面板是浮层色，不必等于触发器色 |
| 面板阴影 | `--dsw-elevation-prominent`（复用） | 参考：dark 阴影几乎不可见、light 有柔和投影；用 DSH 统一 elevation 更稳 |
| 与 trigger 的间距 | **10px** | 参考：12 / 14.5 |
| 模型行高 | 34px，圆角 10px，文本居中，13px / 600，`--dsw-alias-label-primary` | 参考：dark 的 `Instant ›` 居中、纯白、粗体 |
| 模型行右侧 chevron | 8×12 SVG，stroke 1.5px，距文本 12px，`--dsw-alias-label-tertiary` | 参考：宽 6 / 高 11、距文本 14 |
| 轴标字号 | 11px，`--dsw-alias-label-tertiary`，`margin-bottom: 6px` | 参考：cap 12px @ 面板宽 267；DSH 面板更窄，用 11px |
| **面板内轨道宽** | **`PANEL_TRACK_WIDTH = 264 - 2*14 = 236`** | 参考：轨道 = 面板宽 − 2×内边距 |
| 轨道高 / 圆钮 / 刻度点 | **10 / 14 / 3**（沿用现值） | DSH 的 28px 行高放不下 29–36px 的轨道；保持现有比例即可（圆钮/轨道 = 1.4，与参考的 1.11–1.28 同向、溢出更明显一点点） |

### 8.4 必须改的代码点（`lib/client.js`）

1. **CSS 段**
   - `.drs-trigger`：内部由「单 span + caret」改为「model span + effort span + caret svg」；新增 `.drs-trigger-model`（`--dsw-alias-label-primary`，可截断）与 `.drs-trigger-effort`（`--dsw-alias-label-tertiary`，`flex:none`）。
   - 一级不再常驻 `.drs-slider`；新增 `.drs-panel` / `.drs-model-row` / `.drs-effort-block` / `.drs-axis` / `.drs-single`。
   - `.drs-notice` 目前是 `bottom: calc(100% + 6px); right: 0` —— 那块空间现在被面板占了，改成 `bottom: calc(100% + <面板高 + 间距>)` 或干脆移进面板内部。
2. **几何常量**
   - `stopCenter(level, count)` → `stopCenter(level, count, width)`；`trackLayers(count, index)` → `trackLayers(count, index, width)`。
   - 新增 `PANEL_WIDTH = 264`、`PANEL_PAD = 14`、`PANEL_TRACK_WIDTH = PANEL_WIDTH - PANEL_PAD * 2`（= 236）。
   - `TRACK_WIDTH = 142` 保留为回退值，但面板里一律用 `PANEL_TRACK_WIDTH`。
3. **渲染段**
   - `open` 布尔 → `view` 三态。
   - 一级 `children` 只保留 trigger（并补第二段文本）。
   - 面板作为 `children` 的第二项；模型列表（`menu`）作为第三项，且只在 `view === 'models'` 时渲染。
   - 定位 effect：同时支持「上」与「下」，取有空间的一侧。
   - **只有一档（`levels.length === 1`）时**：一级照常显示「模型名 + 唯一档位名」；面板里渲染模型行 + 一句静态说明，**不渲染滑块**。

### 8.5 哪些 Codex 细节**不该**照搬（逐条给理由）

| # | Codex 的做法 | DSH 该怎么做 | 理由 |
|---|---|---|---|
| 1 | **面板宽 = trigger 宽**（light：267 ↔ 268） | **定宽 264px** | DSH 的 seat 挤在输入框一行里，模型名一长 trigger 就接近 `32cqw`；若面板跟它同宽，短模型名时轨道可能只有 60px，滑块拖不动。**dark 参考已经证明面板宽度可以与 trigger 无关**（337 vs 183） |
| 2 | 一级文本**居中**、chevron 绝对贴右（light） | **左对齐，chevron 紧跟强度名**（dark 的做法） | 省宽度。DSH 的 seat 要与输入框争横向空间，居中会在窄宽度下把两端都截断 |
| 3 | 面板里**没有模型行**（Codex 的模型随滑块变） | **必须有模型行** | ① 用户明确要求；② DSH 的滑块只改强度、不改模型，所以模型入口必须有别的地方 |
| 4 | 滑块 stop = **跨模型 preset**（滑动会换模型，5.6 Terra → 5.6 Sol） | stop = **该模型的 `reasoning.efforts`** | DSH 的 adapter 契约是「每个模型自己的档位表」；跨模型 preset 在 DSH 数据模型里不存在 |
| 5 | 刻度点数 = preset 数（6），与「强度档数」不是一回事 | 刻度点数 = 档位数 | 同上；这也是为什么不能把 Codex 的 6 直接当成「DSH 要有 6 档」 |
| 6 | 轨道高 29–36px、圆钮 ⌀37–40px | 轨道 10px、圆钮 14px | DSH 的 seat 是 28px 高的一行，放不下 36px 轨道。DSH 已经把比例调过，视觉剪影（白圆钮溢出、点长在轨道内、单一强调蓝）才是要保住的东西 |
| 7 | dark 的 1px 亮边框 + 几乎不可见的阴影 | 复用 `--dsw-elevation-prominent`，不加自绘边框 | 浮层的观感应跟 DSH 的其它菜单一致 |
| 8 | Codex 用**英文** `Faster` / `Smarter` | **「更快」/「更强」** | 界面是中文 |
| 9 | — | **保留 DSH 自己的粒子流** | Codex 的填充段是纯色，没有粒子。粒子是本插件独有的增补（README 有专节），改造中不应删掉 |
| 10 | — | **一级胶囊上不画任何档位图形**（不画迷你进度条 / 刻度） | 参考图的一级只有文字 + chevron（置信度 高）；用户需求也只要「显示模型名和推理强度」这两个词 |

---

## 9. Q8 · 迁移影响

> 先读了 `README.md`（「填充上的流动粒子」「档位条的构成」两节）、`lib/client.js` 全文、`tools/preview.mjs`、`tools/preview/harness.js`、`tests/bundle.test.mjs` 再作答。

### 9.1 原来常驻的「档位条 + 档位名」怎么处理

| 原来的东西 | 新位置 | 处理 |
|---|---|---|
| `.drs-slider`（轨道 + 粒子 + input） | **面板第二行** | 整块搬进 `.drs-effort-block`，DOM 与 CSS 基本不动，只把宽度来源从 `TRACK_WIDTH`(142) 换成 `PANEL_TRACK_WIDTH`(236) |
| `.drs-effort`（档位名文本） | **并入一级胶囊的第二段** | 不再单独渲染一个 span；由 `.drs-trigger-effort` 承担。面板里不必再画一遍档位名（用 `aria-valuetext` + `title` 即可） |
| 最强档 tooltip「最强档位：思考更充分，也更快消耗额度」 | **一级 trigger 的 `title` + 面板里滑块的 `title`** | 两处都保留（现有一级 `title` 是模型名，现在要拼上档位名与提示） |
| 一级的模型名 + `▾` | 一级的模型名 + 强度名 + **细描边 chevron** | caret 从文本 `▾` 换成 SVG / CSS 图标 |

### 9.2 既有边界在新结构下的对应

| 边界（README 原文） | 新结构下怎么落 |
|---|---|
| **「最弱档不渲染粒子」（`FLOW_MIN_WIDTH = 24`）** | 判据**不变**。但基数从 `(index/(n-1)) × (142 − 14)` 变成 `(index/(n-1)) × (236 − 14)`：<br>· index 0 → flowWidth = 0 → 不渲染（**与原来一致**）<br>· 3 档时 index 1 → 64 → **111px**（原来 64px 因为 >24 而渲染，现在同样渲染，只是更长）<br>· **结论：这条边界的行为不变，只是中间档的粒子带变长。** 若想保持与旧版一致的「克制」观感，可把 `FLOW_MIN_WIDTH` 提到 ≈40（约新基数的 18%）。**建议不要改**——保持判据单一来源 |
| **「只有一档时不渲染控件」** | **保留判据 `levels.length > 1`**，但作用域变了：<br>· 一级：**照常渲染**，显示「模型名 + 该唯一档位名」（比旧版更好：旧版档位名挂在滑块右侧）<br>· 面板：只渲染模型行，**不渲染滑块**；建议补一行 `<p class="drs-single">该模型只有一个推理档位</p>`，否则面板看起来是空的<br>· 这条**需要写进 README**（是本次改造新增的产品决策） |
| **「adapter 未声明 defaultEffort ⇒ 左端插入『默认』档」** | 不变。副作用：一级胶囊的强度段会显示「默认」。这是诚实的（当前确实没有指定强度），**建议保留**，但要在 README 里点明，否则会被误认为 bug |
| **「会话锁定时暂停粒子」（`.drs-flow--idle`）** | 保留。锁定时 trigger `disabled`、面板打不开；但如果面板在锁定瞬间已经开着，粒子的 `animation-play-state:paused` 仍然需要 |
| **「prefers-reduced-motion 关闭动画」** | 不变 |
| **「粒子覆盖层 pointer-events:none + aria-hidden」** | 不变（滑块仍在，仍需不挡拖动） |
| **「覆盖层宽度 = 比例 ×（轨道宽 − 圆钮宽）」** | 公式不变，宽度基数换成 `PANEL_TRACK_WIDTH` |
| **「刻度位置不能用百分比」/ `stopCenter()` 是唯一出处** | **继续遵守**，只是多传一个 `width` 参数。**不要**因为面板定宽就把 236 硬编码进 `stopCenter` 内部——保持它是唯一换算出处 |

### 9.3 测试与验证装置的影响（**最容易漏掉的部分**）

| 文件 | 会不会破 | 具体 |
|---|---|---|
| `tests/bundle.test.mjs` · 「the track is a Codex-style bar」 | **会** | 断言写死了 `'135.00px 100%'`、`['5.50px 50%','69.50px 50%','133.50px 50%']`（基于 W=142）。换成 W=236 后：`stopCenter(2,3,236) = 7 + 1×222 = 229` → `'229.00px 100%'`；点位置 `stopCenter(0,3,236)−1.5 = 5.50`、`stopCenter(1,3,236)−1.5 = **118.50**`、`stopCenter(2,3,236)−1.5 = **227.50**` |
| `tests/bundle.test.mjs` · 「the filled span carries a particle flow」 | **会** | `'128.00px'` → `(2/2)×(236−14) = **222.00px**`；`'64.00px'` → `(1/2)×222 = **111.00px**`；`low` 仍为 0 个 flow（不变）；`locked` 仍是 `drs-flow drs-flow--idle`（不变） |
| `tests/bundle.test.mjs` · 「the seat renders one slider…」/「a provider-default level…」/「a model without reasoning metadata…」/「the slider commits on release…」/「a rejected selection…」 | **会** | 这些都用 `findAll(... type === 'range')` 直接找滑块。**面板默认关闭 ⇒ DOM 里没有 input ⇒ 拿不到 [0] 会抛 TypeError。** 需要让测试先「点击 trigger 打开面板」再取滑块（迷你渲染器 `useState` 不触发重渲染，所以更稳的做法是：把渲染函数抽成接受 `initialView`，或用测试专用 props 钩子；也可以直接断言「关闭时无 range + trigger 文案 = 模型名 + 档位名」） |
| `tests/bundle.test.mjs` · 「the bundle installs its stylesheet once…」 | 可能要改 | 新增的 `.drs-panel` / `.drs-axis` / `.drs-trigger-effort` 是否要加断言；现有断言不冲突 |
| `tests/bundle.test.mjs` · 「the seat refuses to render when unavailable or when the catalogue is empty」 | **不会**（但需复核） | `button` 数仍为 1（trigger） |
| **`tools/preview.mjs`** | **会，而且是硬伤** | 它用 `facts.rows.filter(row => row.slider === true)` 决定像素审计的裁剪区域。面板默认关闭时：<br>① `harness.js` 的 `factsFor()` 里 `wrap.querySelector('input[type="range"]')` 为 null → `slider: false`；<br>② 于是 `sliders.length === 0`，脚本打印 `0 sliders`；<br>③ `regions` 为空数组 → `auditPixels` 不传 regions → **像素审计退化成全页统计**，`occupiedHueBuckets` 不再能证明「只有一个强调蓝」，而这正是 README 里最关键的那条指标。<br>**必须**像现有 `?menu=1` 那样加一个 `?panel=1`（点 trigger 打开面板），并在 `preview.mjs` 里多抓一组 `*-panel.png` |
| `tools/preview/harness.js` | **会** | ① 加 `PANEL_MODE`（对称于 `MENU_MODE`，`stage.style.paddingTop` 要留出面板高度）；② `factsFor()` 里 `label = wrap.querySelector('.drs-effort')` 在关闭态为 null → `labelColor` 为 null，凡依赖它的断言 / 审计都要改；③ `menuFacts()` 现在要等「面板 → 模型行」两步点击 |
| `tools/preview/baseline/client.before.js` | 不动 | 改造前快照，继续用 `--label before` 出对照图 |
| `tools/verify-report.md` | 要补 | 需要一轮新截图证据：一级胶囊（light/dark）、面板打开态（light/dark）、模型列表（light/dark） |
| `scripts/deploy.mjs` | 不受影响 | 软链部署，改 `lib/client.js` 刷新页面即生效 |
| `README.md` | 要改 | ① 顶部形制示意（现在是 `[模型 ▾] ▬▬●▬▬ High`）要换成两级图；② 「形制来源与实测取值」表补上「胶囊双色文本」「面板几何」两组新采样值；③ 「档位条的构成」表加一列说明它现在长在面板里；④ **删掉「未做：Faster ↔ Smarter 轴标」那段**（本次做了）；⑤ 新增「两级结构」小节与本规范互链 |

---

## 10. 未知项与建议默认值

> 原则：**没有像素证据的一律不写成事实**。下面每条都给出可执行的默认值，实现者按默认值做即可，不必等澄清。

| # | 未知项 | 为什么判不了 | **建议默认值** | 理由 |
|---|---|---|---|---|
| 1 | light 面板的 Faster / Smarter 是否常驻 | 单帧 + 该帧确实在交互中（有点击指示叠加） | **常驻** | 轴标与轨道左右端严格对齐（406↔404.5、643↔643.5），是布局元素；面板纵向空间充裕；常驻实现最简单 |
| 2 | dark 的 `Instant` 究竟是模型名还是模式名 | 截图无法分辨「模型」与「模型模式」 | 当作**模型 / 模式名**，做成「模型行 + › → 模型列表」 | 它带 `›` 必是下钻入口；且 dark 的一级不含模型名，面板必须补上。**两种读法在本项目的落点相同** |
| 3 | 悬停 / 按下 / 焦点态 | 无证据 | 沿用现有 token：`--dsw-alias-interactive-bg-hover`（hover）、`--dsw-alias-border-l3` 的 2px ring（focus-visible） | 与 DSH 其它控件一致；参考图拍不到这些态 |
| 4 | 点击轨道是否跳档 / 拖动是否实时预览 / 松手才提交 | 静态图无法判定 | **保留现有行为**（点击跳档、拖动实时预览、松手 / 键盘抬起 / 失焦提交） | 现有实现已有测试钉住；几何与原生 range 一致，原生 range 本来就是这套语义 |
| 5 | 面板宽是否真的 = trigger 宽 | light 上 267 vs 268 的 1px 巧合无法排除；dark 又明确不等 | **定宽 264px** | 像素上最保守；且由 §8.5 #1 的可用性论证支持 |
| 6 | 两张图的 device pixel ratio | 没有 EXIF / DOM 上下文 | **不照搬绝对像素**，按 §8.3 的 DSH 尺度取值 | 两图自身尺度就不一致（胶囊高 33 vs 42、cap 12 vs 15），照搬任一张都会错 |
| 7 | 键盘行为与打开时的焦点落点 | 无证据 | Esc：models → panel → closed；面板 `role="dialog" tabindex="-1"` 并在打开时 focus()；模型列表打开时焦点落第一个 menuitemradio | 保证 Esc 一定可达（焦点在 trigger 上时 keydown 冒泡到 root 也有效，但显式聚焦更稳） |
| 8 | 面板朝上 / 朝下切换的阈值 | 只有两个样本：底部→朝上、中部→朝下 | `上方可用 = rect.top − margin`；`下方可用 = innerHeight − rect.bottom − margin`；取足够放下面板的一侧，都不够则选较大者并 clamp | 从截图直接推出「会翻转」，阈值本身是工程取值 |
| 9 | 面板内是否显示当前档位名的文字 | light 面板里**没有**档位名文本（只有轴标）；dark 里的 `Instant` 判定为模型行 | **不显示**（档位名只在一级胶囊里出现） | 忠于 light；也避免与一级重复 |

---

## 11. 裁剪图清单（`dist/ui-preview/reasoning-slider/recon/`）

所有图为**最近邻整数倍放大**（无插值，保留真实像素块）。坐标是原图 `(x, y, w, h)`。

### light（`reference-codex-slider-light.png`，996×563）

| 文件 | 源坐标 | 倍数 | 看什么 |
|---|---|---|---|
| `light-01-pill-4x.png` | (378,492,296,52) | 4× | 一级胶囊整体：文本居中、chevron 贴右 |
| `light-02-panel-3x.png` | (380,382,292,118) | 3× | 二级面板整体（含注释圆环与手型光标） |
| `light-03-panel-header-6x.png` | (396,400,258,34) | 6× | Faster / Smarter 轴标 |
| `light-04-slider-6x.png` | (398,434,254,44) | 6× | 滑块全程：6 点 + 填充 + 圆钮 + 空轨 |
| `light-05-slider-left-12x.png` | (400,436,46,40) | 12× | 轨道左端胶囊帽 + 第 1 个刻度点 |
| `light-06-slider-right-12x.png` | (596,436,56,40) | 12× | 轨道右端 + 空轨上的刻度点 + 圆钮阴影 |
| `light-07-thumb-12x.png` | (556,430,62,50) | 12× | **圆钮**（被手型光标压住）+ 溢出轨道 + 注释环 |
| `light-08-composer-context-2x.png` | (340,490,420,60) | 2× | 胶囊在输入框中的上下文（麦克风、发送钮） |
| `light-09-pill-caret-12x.png` | (596,504,62,30) | 12× | **一级 chevron**（细描边 V 形，非实心三角） |
| `light-10-pill-text-8x.png` | (452,504,142,30) | 8× | 一级文本整体 |
| `light-11-pill-text-twoTone-10x.png` | (452,506,144,26) | 10× | **双色文本**（5.6 Sol 深 / Extra High 灰） |
| `light-12-panel-to-pill-gap-8x.png` | (400,482,160,28) | 8× | 面板底阴影 → 胶囊顶面的 12px 间距 |
| `light-13-panel-corner-8x.png` | (384,382,50,50) | 8× | 面板圆角与无边框的柔和边 |
| `light-14-header-vs-track-align-6x.png` | (396,400,258,80) | 6× | 轴标与轨道的左右端对齐关系 |
| `light-15-full-panel-plus-pill-2x.png` | (370,382,320,166) | 2× | 面板 + 胶囊的完整相对位置 |

### dark（`reference-codex-slider-dark.png`，1370×519）

| 文件 | 源坐标 | 倍数 | 看什么 |
|---|---|---|---|
| `dark-01-pill-4x.png` | (866,228,300,60) | 4× | 一级胶囊（左对齐的 Thinking effort + chevron） |
| `dark-02-panel-3x.png` | (786,286,364,142) | 3× | 二级面板整体：Instant › + 滑块 |
| `dark-03-panel-header-8x.png` | (918,310,150,34) | 8× | **Instant › 行**（居中、纯白粗体、细 chevron-right） |
| `dark-04-slider-6x.png` | (806,356,326,54) | 6× | 滑块全程：5 点 + 填充 + 圆钮 + 空轨 |
| `dark-05-slider-left-12x.png` | (812,358,50,50) | 12× | 轨道左端 + 第 1 个刻度点 |
| `dark-06-slider-right-12x.png` | (1076,358,56,50) | 12× | 轨道右端 + 空轨点 + 空轨顶部 1px 内高光 |
| `dark-07-thumb-12x.png` | (1004,356,60,54) | 12× | **圆钮**（⌀40，最干净的一张，不受注释干扰） |
| `dark-08-composer-context-2x.png` | (830,226,350,62) | 2× | 胶囊在输入框中的上下文 |
| `dark-09-pill-caret-12x.png` | (1060,240,36,36) | 12× | ⚠️ **废片**：坐标取错，拍到的是麦克风图标。用 `dark-11` 代替 |
| `dark-10-panel-edge-8x.png` | (1080,330,80,100) | 8× | 面板右下圆角 + 空轨右胶囊帽 |
| `dark-11-pill-caret-12x.png` | (1020,246,30,30) | 12× | **一级 chevron**（细描边 V 形） |
| `dark-12-panel-to-pill-gap-8x.png` | (960,276,120,30) | 8× | 胶囊底 → 面板顶的 14.5px 间距 |
| `dark-13-panel-corner-8x.png` | (792,286,56,56) | 8× | 面板左上圆角（r≈22） |
| `dark-14-full-panel-plus-pill-2x.png` | (780,230,380,200) | 2× | 面板 + 胶囊的完整相对位置（朝**下**弹出） |

---

## 12. 外部资料（本地截图与之冲突时以截图为准）

| 资料 | 用途 | URL |
|---|---|---|
| openai/codex issue #31968 | **最强外部佐证**：Codex App「Advanced power slider」的 preset 序列（6 档）与 `5.6 Sol Extra High` 文案逐字吻合 light 图 | <https://github.com/openai/codex/issues/31968> |
| openai/codex issue #32665 | 确认它是「model picker power slider」，stop = {model, reasoning_effort} 组合 | <https://github.com/openai/codex/issues/32665> |
| BleepingComputer：OpenAI is testing "Thinking effort" for ChatGPT | 确认 Thinking effort 是 ChatGPT 那个控件的正式名称（对应 dark 图） | <https://www.bleepingcomputer.com/news/artificial-intelligence/openai-is-testing-thinking-effort-for-chatgpt> |
| ChatGPT Learn · Models | 「在 ChatGPT 桌面端，用输入框下方的模型与推理控件选择模型并调整推理强度」 | <https://learn.chatgpt.com/docs/models> |
| r/ChatGPT：thinking modes changed | 档位名映射线索：Standard→Medium、Extended→High、Heavy→Extra High | <https://www.reddit.com/r/ChatGPT/comments/1u2apvp/thinking_modes_changed> |
| digitalapplied：Effort Dials Arrive | 确认 slider 与 GPT-5.6 Sol 同期发布 | <https://www.digitalapplied.com/blog/thinking-effort-dials-consumer-ai-explained> |
| OpenAI API · Reasoning | 官方 reasoning.effort 取值集合（none/minimal/low/medium/high/xhigh/max）—— 与 DSH adapter 的 efforts 概念对齐 | <https://developers.openai.com/api/docs/guides/reasoning> |

**冲突记录**：外部摘要里有说法称「ChatGPT 的模型选择器被 slider 取代了」。本地截图**不支持**这个强表述——dark 图的面板里仍有一行 `Instant ›` 作为模型入口。**以截图为准**。
