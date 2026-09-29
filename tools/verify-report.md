# dsh-reasoning-slider 0.2.0 独立校验报告

校验者：`slider-verify`（独立于实现者 Lead）
校验时间：2026-09-15
校验对象：`lib/client.js` md5 `f0eb97138459e04568670ab37467d527`（`package.json` version 0.2.0）
写入范围：本文件是本次校验唯一写入的文件；`lib/`、`tests/`、`README.md`、`package.json`、`cordis.patch.yml` 未改动，未执行 `scripts/deploy.mjs`。

> **公开仓库补记（发布时加）**：本文件写于该项目成为公开仓库之前，当时目录不是 git 仓库（见下节），所以用 md5 固定被校验物。
> 发布时已把本机绝对路径脱敏为占位符：`<repo>` = 仓库根、`<dsh-home>` = DSH home（默认 `~/.dsh`）、`<react-store>` = 本机 pnpm store。
> 命令与输出其余部分保持原样，未改写；md5 与时间戳都是当时的真实读数。

### 被校验物的版本指纹（重要）

本仓库**不是 git 仓库**（`git rev-parse` → `not a git repository`），没有版本库兜底，所以我用 md5 固定住"我到底验了什么"：

| 文件 | md5 | 我观察到的 mtime |
|---|---|---|
| `lib/client.js` | `f0eb97138459e04568670ab37467d527` | 19:11 |
| `tests/bundle.test.mjs` | `ed4854d0e5496f37feb301ad15e7ea77` | 19:11 |
| `tests/slot-contract.test.mjs` | `c37c0f81f7602e2838bb00ff55d59795` | 09-13 20:15 |
| `README.md` | `4aac9eee2c876e369766dcc80fcfab56` | 19:15 |
| `package.json` | `b84904fb6da789cabc50b8b2dd531ed0` | 19:14 |
| `tools/preview.mjs` | `ac78e14b364d6e1e3bad7ed8e4e27e45` | 19:13 |
| `tools/preview/harness.js` | `998154541faf12b6b05d28dbe5f23e5d` | 19:12 |
| `tools/preview/pixels.html` | `5cd2efb5c065b1ed27d1875da84c5b03` | 19:13 |

⚠️ **观察到的协作风险**：`README.md` 在我开始校验之后被改过（我 19:14 第一次列目录时它是 8291 B，19:15 变成 8438 B / 144 行）。也就是说**文档在我校验期间还在动**，而 `lib/client.js` 与 `tests/` 停在 19:11 没动过 —— 所以"代码 + 视觉"的结论不受影响，但本报告里所有 README 行号引用（如 `README:25`、`README:116`、`README:139-140`）都以 **md5 `4aac9eee…` 这一版**为准。`tests/slot-contract.test.mjs` 的 mtime 是 09-13，比本次改造更早，即它没有针对 0.2.0 的 slot 行为做过适配性修改（这本身不算问题，它测的是 registry 语义）。

## 0. 结论（先给判定）

| 待验事实 | 我的判定 |
|---|---|
| 21/21 测试通过 | **复现**（21 pass / 0 fail / 175.5ms） |
| 改造后 `vividPixels == 0`、`occupiedHueBuckets == 0` | **复现**（明暗两套都是 0/127732、hues=0） |
| baseline 显著大于 0（即审计有能力发现彩虹） | **复现**（24261/129844 = 18.68%、hues=7；dark 21854、hues=7） |
| 8 条契约红线 | **8/8 成立**（逐条代码位置见 §4），但其中第 5 条「模型菜单」**零测试覆盖** |
| 档位条几何（刻度/填充/手柄换算）真的对 | **独立用像素级测量证实**，误差 ≤1 设备像素（≤0.5 CSS px），见 §7 |

**没有发现推翻结论的错误。** 但有 6 项 Lead 未提及的盲区/未决风险，其中 3 项建议修（§5、§6）：菜单零覆盖、像素审计可能静默产出空结果从而让旧文件冒充证据、`lib/client.js:275` 残留旧设计的注释。

---

## 1. 命令一：契约与行为测试（原始输出尾部）

```
$ cd <repo>
$ node --test tests/bundle.test.mjs tests/slot-contract.test.mjs
✔ the bundle registers one loader entry under the package name (3.5184ms)
✔ the bundle requests only frozen platform modules (2.7106ms)
✔ the bundle installs its stylesheet once, with a removable key (3.5024ms)
✔ the track is a Codex-style level bar: one tick per level over a groove (3.315ms)
✔ only the strongest level carries the consumption hint (1.6137ms)
✔ the manifest declares a web client half resolvable from exports["./client"] (0.2122ms)
✔ the host half is an inert plugin (1.779ms)
✔ apply waits for the three services and shadows the shipped seat (1.3042ms)
✔ the injected face rides the shared per-session directory (1.6133ms)
✔ the injected face degrades instead of throwing (1.4623ms)
✔ an addressed subagent session is unavailable, like the shipped seat (1.3604ms)
✔ the seat renders one slider over the advertised levels, with no per-level accent (1.8156ms)
✔ a provider-default level only appears when the adapter names no default (1.8391ms)
✔ a model without reasoning metadata renders no slider (1.5291ms)
✔ the seat refuses to render when unavailable or when the catalogue is empty (1.2936ms)
✔ the seat survives hostile catalogue payloads (1.3965ms)
✔ the slider commits on release, and only when the level actually changed (1.4169ms)
✔ the provider-default stop omits reasoningEffort entirely (1.363ms)
✔ a rejected selection is swallowed, never thrown at React (12.4289ms)
✔ the seat shadows the shipped occupant on the real registry (14.5418ms)
✔ the plugin leaves the cell untouched when its services never arrive (3.9229ms)
ℹ tests 21
ℹ suites 0
ℹ pass 21
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 175.528
[exit=0]
```

注：`slot-contract.test.mjs` 的两个用例依赖本机 `@deepseek-ai/dsh-client-ui-slots` 是否可达；本机可达，**没有走 skip 分支**（否则 tail 里会出现 `skipped 2`）。测试文件里那两处 `t.skip(...)` 只是兜底。

## 2. 命令二/三：视觉证据复现（原始输出）

两次运行都**一次成功、无 timeout**（单次约 15-25s，全程用无头 Chrome 143 / `C:\Program Files\Google\Chrome\Application\chrome.exe`）。

```
$ node tools/preview.mjs --label verify
preview: inputs
  bundle   <repo>\lib\client.js
  chrome   C:\Program Files\Google\Chrome\Application\chrome.exe
  react    <react-store>\react@18.3.1\node_modules\react\umd\react.development.js
  theme    <dsh-home>\profiles\node_modules\@deepseek-ai\dsh-client-ui-theme\lib\client.js (2 body blocks, 15621 chars)
preview: capturing light → <repo>\dist\ui-preview\reasoning-slider\verify-light.png
  ok — 9 rows, 8 sliders, 0 page problems
    row 1: value 2/2 label="High" layers=5 fill=100% 4px
    row 2: value 1/2 label="Medium" layers=5 fill=100% 4px
    row 3: value 0/2 label="Low" layers=5 fill=100% 4px
    row 4: value 3/4 label="Extra High" layers=7 fill=100% 4px
    row 5: value 4/4 label="Max" layers=7 fill=100% 4px
    row 6: value 0/3 label="默认" layers=6 fill=100% 4px
    row 7: value 0/0 label="High" layers=1 fill=100% 4px
    row 9: value 1/2 label="Medium" layers=5 fill=100% 4px
    pixels: 0/127732 vivid (0) over 8 slider boxes, hues=0, maxSat=0.3333
preview: capturing dark → ...\verify-dark.png
  ok — 9 rows, 8 sliders, 0 page problems
    (同上 8 行；pixels: 0/127732 vivid (0) over 8 slider boxes, hues=0, maxSat=0.2)
preview: done
[exit=0]

$ node tools/preview.mjs --bundle tools/preview/baseline/client.before.js --label verify-before
preview: capturing light → ...\verify-before-light.png
  ok — 9 rows, 8 sliders, 0 page problems
    row 1: value 2/2 label="High" layers=4 fill=100.00% 100%
    row 2: value 1/2 label="Medium" layers=4 fill=50.00% 100%
    row 3: value 0/2 label="Low" layers=4 fill=0.00% 100%
    row 4: value 3/4 label="Extra High" layers=6 fill=75.00% 100%
    row 5: value 4/4 label="Max" layers=6 fill=100.00% 100%
    row 6: value 0/3 label="默认" layers=5 fill=0.00% 100%
    row 7: value 0/0 label="High" layers=2 fill=100.00% 100%
    row 9: value 1/2 label="Medium" layers=4 fill=50.00% 100%
    pixels: 24261/129844 vivid (0.186847) over 8 slider boxes, hues=7, maxSat=1
preview: capturing dark → ...\verify-before-dark.png
    pixels: 21854/129844 vivid (0.16831) over 8 slider boxes, hues=7, maxSat=1
preview: done
[exit=0]
```

`dist/ui-preview/reasoning-slider/verify-light.pixels.json`（原样）：

```json
{ "width": 1840, "height": 1800, "regions": 8, "scoped": true,
  "opaquePixels": 127732, "vividPixels": 0, "vividShare": 0,
  "meanSaturation": 0.0268, "maxSaturation": 0.3333,
  "hueBuckets": [0,0,0,0,0,0,0,0,0,0,0,0], "occupiedHueBuckets": 0 }
```

`verify-dark.pixels.json`：同上，`meanSaturation: 0.0323`、`maxSaturation: 0.2`。
`verify-before-light.pixels.json`：`vividPixels: 24261`、`vividShare: 0.186847`、`meanSaturation: 0.2293`、`maxSaturation: 1`、`hueBuckets: [7956,46,0,0,0,0,0,8345,2652,3285,597,1380]`、`occupiedHueBuckets: 7`。
`verify-before-dark.pixels.json`：`vividPixels: 21854`、`vividShare: 0.16831`、`occupiedHueBuckets: 7`。

**关键判定：baseline 不是 0**，所以这个像素审计**有能力发现彩虹**，不是恒返回 0 的假审计。我又用独立写的直方图脚本（不复用 `pixels.html` 的判定）在**同一裁剪区域**上复核：before-light 有 **34669** 个像素饱和度 ≥0.35（其中 30659 个 ≥0.50），after-light 只有 **13** 个 ≥0.30、**0** 个 ≥0.35 —— 两个方向一致。

另外，我这次 `verify-*` 的数字与更早一次 `after-*` 运行**逐字节相同**（同样的 0/127732、0.3333、0.2），说明装置是可复现的、不是偶然产物。

## 3. 与 Lead/README 说法的逐项对照

| README 第 139-140 行的说法 | 我复现的结果 | 一致？ |
|---|---|---|
| before 24261 / 129844（18.7%），7 桶，峰值 1.00 | 完全相同 | ✅ |
| after **0** / 127732，**0** 桶，0.33(light)/0.20(dark) | 完全相同 | ✅ |
| 「只 require("react")」「不需要 external」 | 全文件只有 1 处 `require(`（`lib/client.js:44`），`package.json` 无 `dsh.client.external` | ✅ |
| 「只用语义 token，没有一处写死品牌色」（README:116） | 12 个 `--dsw-*` 引用**全部有定义**；但 `.drs-*` 里存在写死的 **fallback** 颜色（`#1f1f24`、`rgba(255,255,255,.06)`、`rgba(248,113,113,.16)`…） | ⚠️ 说法偏强（见 §5-c） |
| 「tools/preview/dump-tokens.mjs」存在 | 存在（1636 B） | ✅ |
| 「profiles/web 下是软链，改 lib 刷新即生效」 | `profiles/web/node_modules/dsh-reasoning-slider -> <repo>`，软链成立；两侧 `lib/client.js` md5 完全相同（`f0eb9713…`） | ✅ 且这条很重要：**GUI 加载的就是我校验的那份字节** |

**唯一与实现不符的地方**：`lib/client.js:275` 的 JSDoc 仍写着旧设计 ——

```js
 * Render the composer model seat: model menu on the trigger, reasoning
 * effort on a blue→orange slider.
```

文件头注释（`lib/client.js:7`）是对的（"There is no hue ramp"），但这条函数注释漏改。它不是 `--drs-accent / #3b82f6 / radial-gradient` 那类可被 grep 命中的残留，所以红线清单里的第 8 条抓不到它。**建议改成中性档位条**（1 行）。

## 4. 契约红线逐条（代码位置 + 判断）

1. **只 `require('react')`；`package.json` 无 `dsh.client.external`** — 成立。
   `lib/client.js:44` 是全文件唯一的 `require('react')`；`package.json:27-29` 的 `dsh.client` 只有 `platform: "web"`，没有 `external`。`tools/preview/harness.js:64-68` 的模块表对任何非 `react` 请求直接抛错，而 21 个用例与本次 preview 都 0 problem —— 即"运行期也没偷偷要别的"。
2. **槽位 `conversation.input.model` / `priority -1` / `inject [...]`** — 成立。
   `apply()` 在 `lib/client.js:636` 传 `['slots','modelDirectories','sessions','remote','remote.session']`（5 项、顺序一致）；`:639` 用 `slots.inject('conversation.input.model', …)`；`:641-642` 注册的 `name` 与 `priority: -1` 都在。`:628-635` 那条注释解释了为什么必须显式注入 `remote.session`（cordis 按**访问方 fiber** 解析属性），判断：解释与 `slot-contract.test.mjs:131-134` 里"同优先级注册会抛"的实测互相印证，优先级 `-1` 是必需的而不是风格选择。
3. **拖动只改本地显示，`onPointerUp/onKeyUp/onBlur` 才提交；同档不发请求** — 成立。
   `:530` `onChange` 只 `setDrag(Number(value))`；`:531-533` 三个提交入口；`commit()`（`:442-460`）第一道门就是 `if (level.effort === effectiveEffort) return`（`:446`），所以"松手回到原档""blur 重复触发"都不会打 Host。`onKeyUp` 用 `event.target.value`（DOM 真值）而不是 state，避免 React 异步 setState 的竞态。
4. **adapter 未声明 `defaultEffort` 时最左端有「默认」档且提交省略 `reasoningEffort`** — 成立。
   `:341-342` 只在 `defaultEffort === undefined` 时 `unshift` 一个 `{ effort: undefined, label: '默认' }`；`:447-448` 只在该档有 `effort` 时才往 selection 里写 `reasoningEffort`。preview 的 row 6 实测 `max=3`（3 档 + 1 个默认档），与 row 1-3 的 `max=2` 对照，说明"有默认档时不额外插入"也成立。
5. **模型菜单：Escape 关闭 / 外部 mousedown 关闭 / 视口 clamp / `role=menu`+`menuitemradio`** — 代码成立，**但零测试覆盖**。
   Escape：`:485-490` `onRootKeyDown`（挂在 root div 上，`:601`），menu 也是 root 的子节点，所以焦点在触发器或菜单内都能冒泡到；外部 mousedown：`:380-392`（`rootRef` + `menuRef` 双判）；clamp：`:395-421`，`place()` 先 `x = rect.right - width`、`y = rect.top - 8 - height`，再对 x/y 各自 clamp 进 `[12, innerWidth-width-12]`，并对"菜单比视口还大"用 `Math.max(margin, …)` 兜住；`role="menu"`（`:592`）、`role="menuitemradio"` + `aria-checked`（`:563-564`）、`aria-haspopup/aria-expanded/aria-controls`（`:506-508`）都在。
   ⚠️ 判断：**契约本身没问题，但整套菜单行为在测试里是 0 覆盖**（见 §5-e）。
6. **不可用/空目录/敌意 payload 不抛错；`data-drs-debug` 保留** — 成立。
   注入面 `faceFor()`（`:199-240`）把 `directoryFor/subagentAddress/load/select` 全部包在 try/catch 里，失败退化成 `available:false` + `IDLE_STORE`（稳定快照身份，`:176-183`，对 `useSyncExternalStore` 是必需的）；渲染期再套 `SeatBoundary`（`:246-267`，`:610-612`）；`data-drs-debug` 在两条路径都在：不可用分支 `:434-436`、正常分支 `:605`。空目录分支 `:546-548`（"没有可选模型"文案 vs `status==='loading'`）。
   ⚠️ 小缺口：测试只断言了**不可用分支**的 `data-drs-debug`（`tests/bundle.test.mjs:540-542`），**正常渲染分支的 `:605` 那个节点没有断言**。
7. **`aria-label="推理强度"`、`aria-valuetext` 为档位名** — 成立。
   `:526-527`；`levelLabel` 来自 `levels[index].label`，preview 的 8 行 facts 实测 `ariaLabel="推理强度"`、`ariaValueText` 分别等于 `High/Medium/Low/Extra High/Max/默认`，与右侧 `.drs-effort` 文案一致。
8. **无 `--drs-accent / STOPS / tintAt / radial-gradient / #3b82f6 / #f97316` 残留** — 成立（在生产代码里）。
   全仓 grep 的命中只有三类：`tests/`（断言"已消失"）、`tools/preview/baseline/client.before.js`（改造前快照，故意保留）、以及 `tools/preview/pixels.html`+`preview.mjs` 里描述审计本身的注释/日志。`lib/` 内 0 命中。preview 实测 `trackBackgroundImage` 全是 `linear-gradient(单色,单色)`，`--drs-accent` 取值为空串（`accent: ""`，8 行皆然）。

## 5. Lead 点名的三项 + 我追加的问题

### (a) `stopCenter()` 在 Firefox（`::-moz-range-*`）下是否也成立 —— **推导上成立，但零证据，且有 1 处真实未覆盖风险**

- 换算本身与引擎无关：Firefox 的拇指行程同样是 `trackWidth - thumbWidth`、两端各内缩半个拇指；`tools/preview/harness.js` 的 facts 已经证实在 Chromium 下 `142-12=130` 的行程与 `stopCenter()` 一致，Firefox 用同一套 CSS 盒模型。纵向也对：`TRACK_BOX=14`、`THUMB_SIZE=12`，Firefox 由 UA 居中拇指（`:147` 不设 `margin-top`，正确），Chromium 需要显式 `margin-top:1px`（`:145`），而这 1px 是从同一批常量算出来的（`(TRACK_BOX-THUMB_SIZE)/2`），不是魔数 —— 这点写得对。
- **但是**：`preview.mjs` 的 `findChrome()` 只找 Chrome/Edge，`harness.js:255` 只解析 `::-webkit-slider-thumb` 那条规则。也就是说 **Firefox 的渲染路径（`::-moz-range-track` / `::-moz-range-thumb`）从来没有被任何一次运行执行过**，`README` 与测试也没有 Firefox 相关的说明。这是一个"看起来对称、其实没验"的分支。
- 具体未决风险（我无法在本机证伪，因为没有 Firefox）：`:146-147` 只覆盖了 track/thumb，**没有覆盖 `::-moz-range-progress`**。若某个 Firefox 版本在 `appearance:none` 下仍然绘制原生 progress 填充，它可能与我们的"填充层"叠加/串色；同理 track 伪元素上都没写 `appearance:none`。建议：要么加一条 `input[type=range]::-moz-range-progress{background:transparent}`，要么在 README 明确"仅在 Chromium 内核验证过"。
- 判断：**不是缺陷，是证据缺口**。当前结论"档位条的中性/几何"只对 Chromium 成立。

### (b) 只有一档时只画槽底，会不会让用户困惑 —— **会，属于已知的取舍，但视觉后果被低估了**

我的像素级测量（§7 row 7）：只有 1 档时，整条只有一个 24 设备像素的手柄 + 一条完整空槽，**没有刻度、没有填充**；手柄被原生 range 钉在最左端（实测圆心 673.5，推导值 674）。

- 同一行右侧的档位名仍是 `High`，所以"信息没丢"；`README:25` 也把这条写成了有意设计（"填充会与固定在左端的手柄自相矛盾"）—— 这个理由我认可。
- 但我不同意它"没有代价"：**baseline 在同一行是 100% 满填充的彩虹**，改造后变成一根空槽。对用户来说，"空槽 + 手柄在最左"是"未选择/最低档"的通用视觉语法，与之等价的旧界面表达是"已选满"。也就是说这一档的**信息方向反了**。
- 另外两个小问题：`min===max===0` 的 range 仍然是可聚焦、可拖动的交互控件（拖不动），对 AT 是一段"没有区间的区间"；`atTopLevel` 要求 `levels.length > 1`（`:364`），所以"唯一档就是最强档"时不会显示 `!` 提示（这个我认可是对的，否则会误导）。
- 判断：**保持当前实现可以接受，但建议二选一**——(i) 单档时把刻度画出来并点亮它（不画填充），(ii) 单档时把 range 换成不可交互的静态槽（`disabled` 或 `aria-hidden`）。至少应在 README 里补一句"这一行看起来像未填满是正常的"。

### (c) 是否有地方仍在用未定义的主题 token —— **没有未定义 token；但 preview 只注入了主题的 1/N 张表，导致菜单阴影的截图与真实 GUI 不一致**

- 我把 `lib/client.js` 里出现的 12 个 `--dsw-*` 全部与主题包（`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js`，全文件共定义 357 个）比对：**12/12 都有定义**。11 个在 `design_platform_css_default` 调色板里；`--dsw-elevation-prominent` 不在调色板里，但**在同一 bundle 的 `gradient_shadow_text_css_default` 里**（主题包第 1059 行，`body{… --dsw-elevation-prominent: var(--dsw-elevation-stroke), 0 3px 8px 0 #0000000a, 0 0 20px 0 #0000000d …}`）。所以真实 GUI 里它是有值的，插件也用 `var(…, fallback)` 兜住了。
- **但** `tools/preview.mjs:130-145` 只抽取 `design_platform_css_default` 写进 `theme.css`：**preview 页面里 `--dsw-elevation-prominent` 是 undefined 的**，于是菜单实际画的是 fallback `0 8px 32px rgba(0,0,0,.45)` —— 而真实 token 只有 `0 3px 8px #0000000a + 0 0 20px #0000000d`，**量级差 4 倍以上**。结论：截图里菜单的投影**不是** GUI 里的投影（滑块本身不含 elevation token，所以不影响本次"中性化"的结论）。
- 顺带纠正 README:116 的措辞：`lib/client.js` 里确实**存在写死的颜色**，都在 fallback 位：`.drs-menu` 的 `#1f1f24`（深色菜单底）、`rgba(255,255,255,.06)`（亮色 hover！）、`.drs-notice` 的 `rgba(248,113,113,.16)`/`#f87171`。无主题时这几个 fallback 在浅色界面下会显得突兀。README 说"没有一处写死的品牌色"在**解析后的主路径**上成立，但字面上过强。
- 另有一个语义提醒：所谓"中性"是**主题中性、不是无彩度**。实测 light 主题 `--dsw-alias-label-dimmed` = `#e1e5ee`，是**偏蓝的灰**（饱和度 0.28，见 §6-3）。`lib/client.js:67-71` 的注释只说"flip with the theme"，没提这一点。

### (d) 追加：像素审计有两处"证据可信度"问题（建议修）

1. **审计静默失败时会留下旧的 `*.pixels.json` 冒充新证据。** `preview.mjs:326-328`：`auditPixels` 返回 `null` 时只 `console.warn('pixel audit produced no result')`，**不写文件也不退出非 0**；而 `*.pixels.json` 内容里没有任何字段标明它是哪个 bundle / 哪次运行产生的（只有文件名里的 `label`）。所以"读 `verify-light.pixels.json` 看到 0"并不足以证明"刚才那次审计通过了"——必须同时检查日志里没有那行 warning。我这次两次运行都正常产出了（8 regions、`scoped: true`），但这是流程风险，不是假设。
2. **`occupiedHueBuckets` 不是第二个独立证据。** `pixels.html:74-82`：只有先通过 `vivid` 判定（`saturation >= 0.35`）才会累加色相桶。因此 `vividPixels === 0` ⟹ `occupiedHueBuckets === 0` **恒成立**，二者是同一个测量的两种说法。任务书/README 把"vividPixels 与 occupiedHueBuckets 都为 0"并列成两项核对，容易让人误以为交叉验证过。

### (e) 追加：模型菜单是**结构性零覆盖**，不是"漏了一条用例"

- 全测试目录 grep `Escape|menuitemradio|drs-menu|mousedown|clamp|innerWidth` → **0 命中**。21 个用例里没有一个碰菜单。
- 根本原因在测试装置的实现：`tests/bundle.test.mjs:164-180` 的 `renderTree` 是**单趟遍历**，`:55-58` 的 `useState` 只改内部 list、**不会触发重渲染**。而菜单渲染条件是 `open === true`（`lib/client.js:541`），`setOpen` 永远无法让它变成 `true`；同理"拖动实时跟随"（`drag`→`index`）在单测里也跑不到。于是 **`preview.mjs` 的交互式证据也没有**：它的 9 行是固定 fixture 的静态矩阵，不点触发器。
- 因此红线第 5 条（菜单 4 项行为）目前**只有我的代码阅读**支撑。这不算推翻，但"21/21 通过"的信息量比数字看起来小：它主要覆盖首次渲染 + 直接调用处理器。
- 建议：要么给 `renderTree` 加一次重渲染（把 `useState` 的 setter 记下来、改完再跑一遍组件），要么在 `preview/harness.js` 的矩阵里加"菜单展开"和"拖动中"两行 fixture（点一下触发器即可），把 Escape/外点/clamp 至少变成有一条真 React 路径的 smoke test。

### (f) 追加：浅色主题下"中性"的余量只有 5%

用我自己的直方图脚本，在同一 8 个滑块裁剪框内统计饱和度分布：

| 图像 | ≥0.20 | ≥0.30 | **≥0.35（审计判定线）** | ≥0.50 |
|---|---|---|---|---|
| after-light | 8426 | 13 | **0** | 0 |
| after-dark | 0 | 0 | **0** | 0 |
| before-light | 38957 | 35724 | **34669** | 30659 |
| before-dark | 29491 | 24823 | **22055** | 15773 |

- 好的一面：审计的 0.35 判定线把前后分得**极其干净**（0 vs 34669/22055），阈值不是靠运气选出来的。
- 需要写明的一面：after-light 的 `maxSaturation = 0.3333`，**距判定线只剩 4.8%**，而它来自主题自己的"中性"token（`#e1e5ee` 那种偏蓝灰，采样像素如 `rgb(225,229,238)`、`(243,245,248)`）。含义有两层：(i) 结论应表述为"没有强色相/没有彩虹"，**不是**"逐像素无彩度"；(ii) 如果将来主题把某个中性 token 调得更蓝一点，或有人加一个饱和度 0.30 的"轻微着色"，审计会在**仍然通过**的情况下放过它。更稳的比较量是 `meanSaturation`（0.0268 vs 0.2293，降 8.6×；dark 0.0323 vs 0.156，降 4.8×）和色相桶分布，建议在 README 里把均值一起列出，别只写 0。

### (g) 追加：一处**既存**（非本次回归）的显示边界

`settled` 的解析（`:353-359`）以 `levels` 里的 `effort === effectiveEffort` 为准；若 adapter 声明的 `defaultEffort` **不在**它自己上报的 `efforts` 里，`settled` 会保持默认值 `0`，界面显示最左档，而会话其实跑着 provider 默认档。我用同一段逻辑比对过 `tools/preview/baseline/client.before.js:340-348`，**与改造前完全一致**，所以这不是本次重做引入的回归，属于既存显示边界（建议以后单独处理，例如找不到时补一个"默认"档或显示 provider 默认值）。

## 6. 我无法验证 / 未决风险（如实列出）

1. **真实 GUI 端到端未经我点验。** 我能证明的是"部署路径是软链、两侧 `lib/client.js` md5 相同"（§3），以及"真 Chrome + 真 React + 真主题 token 下渲染正确"（§2、§7）。但**我没有操作 3080 端口的 GUI**（不刷新页面、不点击），所以"页面上看到的到底是不是这几张截图"这一步依赖软链成立 + 宿主 HMR 行为，不是我的直接观察。
2. **Firefox 完全未验证**（§5-a）。
3. **`--only light|dark` 未单独跑过**：我按任务书跑了完整的两套主题，没有用到该开关，故对其正确性无结论。
4. **触摸/笔输入未验证**：拖动提交依赖 `onPointerUp` 落到 `<input>` 上。Chromium 对 range 有隐式指针捕获，正常情况下松手即使在控件外也会回调；但这条我只做了代码阅读，没有在触屏/指针设备上实测（真发生漏回调，`onBlur` 是兜底，所以后果有限）。
5. **a11y 键盘导航**：`role="menu"` 下没有方向键/Home/End 漫游焦点，打开菜单时也不移动焦点（`:588-598` 只挂 id/ref/role/style）。Escape 与外部点击有，Tab 也能走通按钮，所以我判定为"可用但不符合 WAI-ARIA menu 模式的完整要求"，**未做屏幕阅读器实测**。
6. **`dsh --profile web --dump-config` 未跑**（README:143 提到），因为本次目标是复现视觉与契约结论，不是组合配置。

## 7. 附：我自己做的像素级几何复核（装置之外的第二条证据）

审计只统计颜色，**不检查刻度/填充画在哪**。我另写了一个临时扫描页（在系统临时目录，未写入本仓库），把两张截图按 8 个滑块框逐列扫描，测出每根刻度的中心、手柄圆心的实测像素位置、以及"填充/槽"的分界，再与 `stopCenter()` 的推导值对比（`stopCenter(i,n) = 6 + i/(n-1)·130`，设备像素 = CSS×2）：

| 行 | 档位 | 轨道左沿(设备px) | 刻度中心 实测 / 推导 | 手柄圆心 实测 / 推导 | 误差(设备px) | 填充可见末端 实测 / 推导 |
|---|---|---|---|---|---|---|
| 1 | 2/2 (3 档顶档) | 643.31 | 654.5 / 655.31，784.5 / 785.31，914.5(与手柄合并) / 915.31 | 914.5 / 915.31 | −0.81 | 898 / 899.31 |
| 2 | 1/2 | 626.64 | 638.5 / 638.64，768.5(与手柄合并)，898.5 / 898.64 | 768.5 / 768.64 | −0.14 | 752 / 752.64 |
| 3 | 0/2 | 669.47 | 680.5(与手柄合并)，810.5 / 811.47，940.5 / 941.47 | 680.5 / 681.47 | −0.97 | 填充完全被手柄遮住（符合 6px<12px 的推导） |
| 4 | 3/4 (5 档) | 605.97 | 617.5/617.97，682.5/682.97，747.5/747.97，812.5(合并)，877.5/877.97 | 812.5 / 812.97 | −0.47 | 796 / 796.97 |
| 5 | 4/4 (顶档) | 648.47 | 659.5/660.47，724.5/725.47，789.5/790.47，854.5/855.47，919.5(合并) | 919.5 / 920.47 | −0.97 | 903 / 904.47 |
| 6 | 0/3 (含「默认」档) | 666.00 | 677.5(合并)，764.5/764.67，850.5/851.33，937.5/938 | 677.5 / 678 | −0.50 | 填充被手柄遮住（同上） |
| 7 | 0/0 (只有一档) | 662.00 | **无任何刻度**（唯一的高块是手柄） | 673.5 / 674（原生 range 钉左端） | −0.50 | 无填充，仅整条槽 |
| 9 | 1/2 (locked) | 626.64 | 与 row 2 完全一致 | 768.5 / 768.64 | −0.14 | 752 / 752.64 |

方法学与误差来源：所有实测值都比推导值**系统性小 0.14~0.97 设备像素**，因为我用 `floor(rect.x*2)` 把非整数的轨道左沿（如 643.3125）截断、且圆形/矩形的边缘像素是抗锯齿的（我按"与背景差 >12"判定墨迹，边缘那一列可能落在阈值内）。**结论：刻度中心、手柄圆心、填充末端与 `stopCenter()` 的推导在明暗两套主题、8 个滑块上都一致到 ≤1 设备像素（≤0.5 CSS px）**；"填充到手柄圆心"这一条也被证实——填充色块的可见末端正好落在手柄的 2px 描边外沿（例：row 1 实测 898 vs 推导 899.31；row 5 实测 903 vs 904.47），即填充确实被手柄+描边盖住、而不是停在别处。

同一批数据还确认了几件事：
- 未到达的刻度用的是 `--dsw-alias-label-tertiary`（light `#81858c` / dark `#adb2b8`），到达的刻度与填充同色（light `#61666b` / dark `#cfd3d6`）—— 即"到达/未到达"确实只有一种含义，没有颜色表达强弱。
- 槽色随主题翻转：light `#e1e5ee`，dark `#43454a`（不是 fallback，是主题真值）。
- 手柄在 dark 主题下是浅色（`#f9fafb`），在浅色主题下是深色（`#0f1115`），两套都清晰可辨；locked 行（row 9）三个颜色正好是 normal 行的 55% 混色（`#a7aaad`/`#7a7b7e`/`#eef0f5`），与 `.drs-range:disabled{opacity:.55}` 吻合。

## 8. 复现命令清单（我实际执行的）

```bash
cd <repo>
node --test tests/bundle.test.mjs tests/slot-contract.test.mjs
node tools/preview.mjs --label verify
node tools/preview.mjs --bundle tools/preview/baseline/client.before.js --label verify-before
# 产物：<repo>/dist/ui-preview/reasoning-slider/verify-*.{png,facts.json,pixels.json}
```

只读的附加核查（无需重跑）：对主题 token 定义做全量比对、对 `verify-*.png` 做逐列扫描与饱和度直方图（脚本在系统临时目录，未落进仓库）、比对 `profiles/web` 软链两侧的 md5。
---

# 补记 · 第 4 轮：两级结构改造的测试与截图证据

补记者：teammate `seat-structure`（**本轮实现者**，不是独立校验者——上面那份 0.2.0 报告的"独立"属性不适用于本节）。
改动面：`lib/client.js`（一级摘要 + 二级面板 + 三级模型列表）、`tests/bundle.test.mjs`、`tools/preview.mjs`、
`tools/preview/harness.js`、`README.md`、本文件。
**刻意未改**：`.drs-flow` / `.drs-flow-a` / `.drs-flow-b` / 两条 `drs-flow-*` keyframes / `.drs-flow--idle` /
reduce-motion 里那条 flow 规则（留给 teammate `particle-flicker` 做最后一棒），以及 `lib/index.js`、`package.json`、`cordis.patch.yml`、`scripts/deploy.mjs`。

## 9.1 本轮指纹（仓库不是 git 仓库，仍然只能用 md5 固定"验的是哪一版"）

| 文件 | md5 |
|---|---|
| `lib/client.js` | `5c3c88b8e69b8b12a89431c212bc2a0d` |
| `tests/bundle.test.mjs` | `25b943acd68cab2518e47dbb5d07d1da` |
| `tests/slot-contract.test.mjs` | `c37c0f81f7602e2838bb00ff55d59795`（本轮**未改**） |
| `tools/preview.mjs` | `bd6eac3cac36c0336d9a4573bd8a309b` |
| `tools/preview/harness.js` | `d95a05577f89b4b5bfdc439e43910eac` |
| `README.md` | `7dc8cd204afc50459cc3c8aa3d0d703e`（写入后又被本补记作者的措辞修订动过，行号引用以当前文件为准） |

## 9.2 命令一：契约与行为（原始输出尾部）

```
$ node --test tests/bundle.test.mjs tests/slot-contract.test.mjs
✔ the bundle registers one loader entry under the package name (3.4199ms)
✔ the bundle installs its stylesheet once, with a removable key (2.2678ms)
✔ the collapsed seat is a two-tone summary, and holds no slider (2.8853ms)
✔ the panel holds the model row and the bar, and the row drills into the model list (2.1552ms)
✔ the track is a Codex-style bar: in-track dots over a fill on a pill track (1.8752ms)
✔ only the strongest level carries the consumption hint, and only in the tooltip (1.7933ms)
✔ the filled span carries a particle flow that stops when it should (1.8937ms)
✔ the seat renders one slider over the advertised levels, with no per-level accent (1.3133ms)
✔ a provider-default level only appears when the adapter names no default (1.9899ms)
✔ a model without reasoning metadata renders no slider (1.1727ms)
✔ the seat refuses to render when unavailable or when the catalogue is empty (1.0562ms)
✔ the slider commits on release, and only when the level actually changed (1.3936ms)
✔ the provider-default stop omits reasoningEffort entirely (1.2241ms)
✔ a rejected selection is swallowed, never thrown at React (10.7476ms)
✔ the seat shadows the shipped occupant on the real registry (12.277ms)
✔ the plugin leaves the cell untouched when its services never arrive (2.7711ms)
ℹ tests 24
ℹ suites 0
ℹ pass 24
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 149.863
[exit=0]
```

与结构直接相关的新断言（不是"跑过了"，是"钉住了"）：

* **收起态语义**：关闭时 DOM 里**没有** `input[type=range]`、没有 `role=dialog`、没有 `role=menu`，
  且 `data-drs-debug` 里的 `view` 是 `"closed"`；一级文案 = `['DeepSeek Chat','High']` 两段，caret 的 `type === 'svg'`。
* **面板结构**：`role=dialog` + `tabIndex=-1` + `aria-label="模型与推理强度"`；模型行的 `.drs-model-row-name` 与 `.drs-chevron-right`；
  轴标 `aria-hidden` 且文案是 `['更快','更强']`；`trigger.aria-controls === panel.id`。
* **三级替换二级**：`view='models'` 时 `role=menu` 在、`role=dialog` 不在（不是叠在一起）。
* **锁定态贯通三层**：trigger / 模型行 / range 全部 `disabled`，且 flow 是 `drs-flow drs-flow--idle`。
* **几何按 236 基数重算**：填充 `'229.00px 100%'`、点位置 `['5.50px 50%','116.50px 50%','227.50px 50%']`、
  flow `'222.00px'`（3 档中间档）/ `'111.00px'`、最弱档 0 个 flow。
* **单档位**：面板里没有 range 也没有 `.drs-axis`，但有 `.drs-single`「该模型只有一个推理档位」，一级仍显示该档位名。
* **三条 flow 断言原样保留**（`/@keyframes drs-flow-a/`、`/\.drs-flow\{[^}]*pointer-events:none/`、`/prefers-reduced-motion:reduce\)\{\.drs-flow-a/`）——
  它们是 particle-flicker 的基线，本轮一个字都没动。

## 9.3 命令二：视觉装置（原始输出，明暗各一套）

```
$ node tools/preview.mjs --label after2
preview: capturing light → ...\dist\ui-preview\reasoning-slider\after2-light.png
  ok — 10 rows, 0 sliders, 0 page problems
    row 9: trigger="deepseek-v4.1-flash-preview-0731Extra High" effort="Extra High" caret=<svg> expanded=false slider=false modelClipped=true effortClipped=false
    row 10: trigger="DeepSeek V4.1 FlashMedium" effort="Medium" caret=<svg> expanded=false slider=false modelClipped=false effortClipped=false
    pixels: 0/215656 vivid (0) over 10 slider boxes, hues=0, maxSat=1, meanSat=0.0124
    menu: open=true groups=2 options=3 checked=1 labels=["DeepSeek V4.1 Flash✓","DeepSeek Reasoner","GPT-5.6 Codex"]
    panel: side=top (want top) 264x114 @ 239.0,168.0 onScreen=true radius=16px pad=12px 14px 14px 14px axis=["更快","更强"] modelRow="DeepSeek V4.1 Flash"@34px chevron=<svg>
      trigger="DeepSeek V4.1 FlashHigh" caret=<svg> title="DeepSeek V4.1 Flash · High" track=3px 3px,...,118.00px 100%,100% 100% fill=100% 100%
      pixels: 4435/20768 vivid (0.21355) over 1 bar box, hues=1, maxSat=1, meanSat=0.2265
    panel-down: side=bottom (want bottom) 264x114 @ 239.0,154.0 onScreen=true radius=16px pad=12px 14px 14px 14px axis=["更快","更强"] modelRow="DeepSeek V4.1 Flash"@34px chevron=<svg>
preview: capturing dark → ...\after2-dark.png
  ok — 10 rows, 0 sliders, 0 page problems
    pixels: 0/215656 vivid (0) over 10 slider boxes, hues=0, maxSat=0.2, meanSat=0.0289
    panel: side=top (want top) 264x114 @ 239.0,168.0 onScreen=true ...
      pixels: 4433/20768 vivid (0.213453) over 1 bar box, hues=1, maxSat=1, meanSat=0.2106
    panel-down: side=bottom (want bottom) 264x114 @ 239.0,154.0 onScreen=true ...
preview: done
[exit=0]
```

逐条判读：

| 待验事实 | 判定 |
|---|---|
| 收起态矩阵里没有任何档位条 | **成立**（10 rows / 0 sliders；`?panel=1` 那一组才有滑块） |
| 面板里的档位条仍然只有一个色相 | **成立**（light 4435/20768、hues=**1**；dark 4433/20768、hues=**1**） |
| 收起态本身不泄漏强调色 | **成立**（0/215656 vivid、hues=0；裁的是 10 个 trigger 框） |
| 面板尺寸/圆角/内边距与规范一致 | **成立**（264×114、radius 16px、padding 12px 14px 14px 14px） |
| 模型行存在且是 34px、带 chevron-right | **成立**（modelRow 文本 + @34px + chevron=svg） |
| 轴标文案与对齐 | **成立**（`["更快","更强"]`，规则里 `justify-content:space-between`） |
| 面板方向会翻转 | **成立**（同一装置内：留白 200px 时 side=top、留白 24px 时 side=bottom，两次都 onScreen=true） |
| 长模型名不破版 | **成立**（row 9：`modelClipped=true` 而 `effortClipped=false`，即省略号只吃模型段） |
| 三级模型列表仍可用 | **成立**（真点击 trigger → 模型行：2 组 / 3 选项 / 1 个 ✓） |

## 9.4 面板翻转是怎么测的（不是"代码看起来会翻转"）

`tools/preview/harness.js` 新增 `?panel=1`（打开面板）与 `&dir=down`（把 seat 挪到页面顶部，制造"上方空间不足"），
面板把选择结果写进 `data-drs-side`，facts 里连同 `onScreen`（四条边是否都在视口内）一起回报；
`tools/preview.mjs` 对两者做**硬断言**：期望 `top` 却拿到 `bottom`（或反之）就 `failures += 1` 并以非 0 退出。
判据本身（`lib/client.js`）：`roomAbove = rect.top − gap − margin`、`roomBelow = innerHeight − rect.bottom − gap − margin`，
哪边放得下整个浮层就选哪边；两边都放不下时选空间较大的一侧，再统一 clamp 进视口。

覆盖边界：`dir=down` 是**合成的空间不足**，验的是判据与 clamp，不代表某个具体窗口尺寸下的表现。

## 9.5 本轮**没有**覆盖的（别把这轮绿当成全绿）

1. **真实 GUI 端到端不在本轮**。本轮只做了装置层（真 Chrome + 真 React + 真主题 token + 真点击，但页面是 `file://` 的合成 fixture）。
   3080 上那个真实页面的点验由 Lead 的只读 `tools/live-gui-check.mjs` 负责，结果不在本文件里。
2. **焦点行为（第 4.1 轮已补测，见 §9.7）**：面板打开时把焦点移进面板、模型列表打开时移进第一个选项（Esc 因此逐级可达：
   models → panel → closed），关闭时把焦点还给 trigger。实测见 §9.7；真实输入框在面板打开期间仍会失去键盘焦点（ChatGPT 同样如此），未端到端验证。
3. **Firefox 仍然零证据**（与上一轮相同，本轮未碰 `::-moz-*` 那几条规则）。
4. **单测打开两态靠一个 test-only props**（`initialView`，注入面永不传、生产恒为 `'closed'`）。
   这是为了绕过迷你渲染器"`useState` 不回灌"的限制；真实点击路径由 `*-panel.png / *-panel-down.png / *-menu.png` 覆盖。
5. **像素审计只覆盖面板里的档位条框**（236×22 CSS px，dpr 2）。收起态那 0/215656 只能说明"10 个 trigger 框里没有强色相"，
   不能推广成"这一版没有任何强调色"——它本来就不该有。

## 9.6 规范勘误（`tools/codex-effort-picker-spec.md` §9.3）

规范 §9.3 给的三档刻度点期望值是 `5.50 / 118.50 / 227.50`。其中**中间那个数是笔误**：
同一节要求沿用 §6.1 的 dark 公式（也正是 `stopCenter()` 一直在用的），代入 W=236、n=3 得
`stopCenter(i) = 7 + i×111` → 7 / 118 / 229，圆点半径 1.5 → 偏移 **5.50 / 116.50 / 227.50**。
规范自己的第一个（7−1.5=5.50）与第三个（229−1.5=227.50）都与该公式吻合，只有中间那个对不上，所以按公式落地，
测试钉的是 `116.50`。填充宽 229.00px、flow 222.00/111.00px 与规范一致。

另：规范 §8.4.2 说 `TRACK_WIDTH = 142` 保留为回退值——已照办，它现在是 `stopCenter`/`trackLayers` 的 width 参数缺省值，
而两个调用点都显式传 `PANEL_TRACK_WIDTH`，所以 236 没有硬编码进换算函数（§9.2 那条要求仍然成立）。

## 9.7 补测（第 4.1 轮）：关闭路径的焦点去向

背景：§9.5 第 2 条当时是"焦点行为只在装置里看过、只是代码推演"。实测后**发现一个真 bug**，已修，并补了浏览器侧证据。

**bug**：面板首帧用的是 `visibility:hidden`（位置在 layout effect 里才量出来），而**隐藏元素收不到焦点**——
所以"打开时把焦点移进面板"这个 effect 只依赖 `view`，在无头页里实测到的 `document.activeElement` 一直是 `body`：
焦点其实从未真正进入面板（真实 GUI 里表现为焦点停在 trigger 上）。修法：effect 的依赖里加"已定位"（`floatPos !== null`），
既让首次定位后补一次聚焦，又不会在后续 scroll/resize 重定位时把焦点反复拽回面板。

**关闭路径统一化**：新增 `closeFloat(restore)`，所有关闭入口收敛到它：

| 入口 | restore | 理由 |
|---|---|---|
| Esc（面板层） | ✅ | 被聚焦的节点即将卸载，不还焦点就掉到 `<body>` |
| 选中模型（含点当前模型） | ✅ | 同上（选项即将卸载） |
| 点 trigger 收起 | ✅ | 焦点本来就在 trigger 上，等于幂等 |
| 点击外部 | ❌ | 用户正在聚焦别的东西，抢回来比他丢掉更糟 |

trigger 为 `disabled`（会话锁定）时不强求，直接跳过。

**装置实测**（`tools/preview/harness.js` 的 `?focus=1`：真点击开 → 派发 Esc → 再点开 → 外部 mousedown，逐步读 `document.activeElement`；
`tools/preview.mjs` 逐条硬断言，不符即非 0 退出）：

```
$ node tools/preview.mjs --label after3
    focus: after-open=panel/.drs-panel → after-escape=closed/trigger → after-reopen=panel/.drs-panel → after-outside-mousedown=closed/body
```

对应 `after3-light-focus.facts.json` 里的原始记录（4 条，逐条含 tag/className/role/isTrigger/inPanel/view）：

| label | view | 焦点落在 | inPanel | isTrigger |
|---|---|---|---|---|
| after-open | panel | `div.drs-panel` (role=dialog) | true | false |
| after-escape | closed | `button.drs-trigger` | false | **true** |
| after-reopen | panel | `div.drs-panel` (role=dialog) | true | false |
| after-outside-mousedown | closed | `body` | false | false（**没有抢**） |

单测侧的边界（如实说明）：焦点是 `useLayoutEffect` 行为，迷你渲染器既不跑 effect 也不能在 `useState` 之后重渲染，
所以 `tests/bundle.test.mjs` 里新增的那条只断言"三条关闭入口存在且不抛错"，**行为证据只有上面这份浏览器实测**。

补测后的完整测试输出尾部（§9.2 那份是补测前的 24 条，本轮 +1 条关闭路径 smoke test）：

```
ℹ tests 25
ℹ suites 0
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 234.0582
[exit=0]
```

---

# 第 6 轮 · 档位条加粗 1.5× + 悬停读数（2026-09-16）

用户要求：①「鼠标悬停在特定档位时，显示指定档位强度」②「将滑块宽度加大至原来 1.5 倍」。

> **口径更正**：第一版按字面把**长度**做到 1.5×（236 → 354px，面板 382px），用户随即澄清
> 「**不是变长，改回去，是要变粗**」。最终落地是**宽度不动、厚度 1.5×**。下面记的是最终态。

## 6.1 改动

| 项 | 改前 | 改后 | 依据 |
|---|---|---|---|
| 档位条宽 | 236px | **236px（不动）** | 用户要的是粗，不是长 |
| 面板宽 | 264px | **264px（不动）** | 同上 |
| 轨道高 / 圆钮 / 刻度点 | 10 / 14 / 3 | **15 / 21 / 4.5**（三者同乘 `BAR_SCALE = 1.5`） | 只加粗轨道会把圆钮吞进条里、丢掉 Codex 剪影，所以一起放大 |
| range 高度 | 22px | **29px = 圆钮 + 8** | 容器必须比圆钮高，否则圆钮被裁 |
| 悬停读数 | 无 | `.drs-hover` 浮在指针所在档位上方 | 用户口径 |

读数实现：`stopAtPointer()` 用 `stopCenter(i, n, rect.width)` 找最近档位（与刻度点、填充同一换算）；
`onPointerMove` / `onPointerLeave` 挂在 `.drs-track-wrap`；位置写成
`clamp(52px,calc(7px + ratio × (100% - 14px)),calc(100% - 52px))`（同一条线性映射的 CSS 形式，窄视口也成立）；
`pointer-events:none`；离开、面板关闭、切到模型列表都会清空。

## 6.2 证据（最终字节 md5 `A833AF99…`，profile 软链两侧一致）

单测：`node --test tests/bundle.test.mjs tests/slot-contract.test.mjs tests/flow-flicker.test.mjs`

```
ℹ tests 38
ℹ suites 0
ℹ pass 38
ℹ fail 0
[exit=0]
```

（新增 1 条悬停结构测试；几何断言按 21px 圆钮重算：填充 `225.50px`、刻度点 `8.25 / 115.75 / 223.25`、flow `215.00 / 107.50`，宽度仍是 236px；
另钉住 `.drs-range` 的 `height:29px`、`::-webkit-slider-runnable-track` 的 `height:15px` 与刻度点 `4.5px`）

预览装置（真 Chrome + 真 React + 真主题 token，两套主题 × 面板朝上/朝下）：

```
hover: ["Low","Medium","High","Extra High","Max"] centre-error=0.00px current="High"/"High" afterLeave=null
panel: side=top (want top) 264x121 ... axis=["更快","更强"]
pixels: 6440/27376 vivid (0.235243) over 1 bar box, hues=1
```

实时 GUI（`node tools/live-gui-check.mjs --label final`，22/22 PASS）：

```
PASS the bar keeps its shipped width  [sliderWidth=236]
PASS the panel keeps its width  [panelWidth=264]
PASS the bar is 1.5x as thick  [inputHeight=29 track=29px]
PASS every stop names itself under the pointer  [["默认","Off","Low","High","Max"]]
PASS the readout tracks the stop it names  [centreError=0]
PASS the stop in force reads back its own name  ["High" vs "High"]
PASS leaving the bar retires the readout  [null]
```

## 6.3 本轮踩到的两个坑（都在验证装置侧，不在产品侧）

1. **React 18 会批处理事件产生的 state**：`dispatchEvent` 返回时 DOM 还没更新，同步读 `.drs-hover` 恒为 null
   （第一次跑因此误判成「读数没渲染」）。把探针改成 settle 循环里的**步进**（发事件一步、读结果一步）后不再依赖 `flushSync`。
2. **`onPointerLeave` 不是原生事件监听**：React 从 `pointerout` / `pointerover` 合成 enter/leave（leave 不冒泡、不被委托），
   所以「让指针离开」必须发 `pointerout`（relatedTarget 落在条外），否则读数永远收不起来。

## 6.4 覆盖边界

`BAR_SCALE` 在 `lib/client.js` 顶部一处定义，轨道/圆钮/刻度点都由它派生（刻度点的绘制半径也从写死的 1.5px 改成 `DOT_SIZE / 2`），
所以再调粗细只动这一个数；粒子点阵的半径没有跟着放大（那是上一轮定稿的纹理，本轮不动）。

Firefox 仍未实测；读数气泡与轴标在垂直方向上有重叠（浮层短暂盖住「更快 / 更强」），
那是当前面板纵向空间的唯一可用位置，已在真实 GUI 截图里确认两端标签仍然可见。


