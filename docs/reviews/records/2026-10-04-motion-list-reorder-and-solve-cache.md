# 动效弹簧续作（列表让位 / 求解缓存 / 文档失真）

<!-- lissio-review
date: 2026-10-04
scope: 退场位移补偿（兄弟节点跳变）；springFromTiming 求解缓存；motion-spatial-plan.md 一处功能失真的核实与订正
reviewer: 维护者（Horldsence）
verdict: 有条件通过
-->

继续 `docs/architecture/motion-spatial-plan.md` 的待改造清单，落地其中的退场位移补偿，
关闭上一轮记录的遗留项 3，并核实该文档中一处指向不存在功能的描述。

## 范围

| 项 | 内容 |
| --- | --- |
| 1 | 新增 `src/lib/motion/flipReorder.ts`：把 FLIP 机制从 `dockFlip.ts` 提取为可参数化的通用 hook（身份属性 + 家族），`dockFlip.ts` 降为接入点 |
| 2 | 退场位移补偿接入三处块列表：`FrameDecoder.tsx` / `CommandSenderBlockList.tsx` / `ProtocolBlocksEditor.tsx` |
| 3 | 新增 `flipReorder.test.tsx`：删除与插入两种变化的让位断言 |
| 4 | `springFromTiming` 加求解缓存；订正 `motionConfig.ts` 中"已 memoised"的失效注释 |
| 5 | 核实并订正 `motion-spatial-plan.md` 的"Widget 卡片布局重排（FRUIT 拖拽改序）" |

## 结论

| 清单项 | 结论 |
| --- | --- |
| 1.3 引用真实性 | `ui-motion.md` 模块表新增 `flipReorder.ts` 并改写 `dockFlip.ts` 职责，与 `src/lib/motion/` 实际文件一致；`motion-spatial-plan.md` 已具备的能力表同步补齐 `useFlipReorder` |
| 2.1 许可证表述 | 未新增第三方依赖，未改动任何许可证字段或对外表述 |
| 2.6 对外表述 | 未涉及 |
| 3.3 元数据 | 本记录为新增记录，`docs/reviews/README.md` 索引表已追加一行 |
| 5.1 门禁 | `pnpm typecheck`、`pnpm lint:ci`、`pnpm test`、`pnpm build:web`、`pnpm check:docs`、`pnpm check:tokens`、`pnpm docs:motion`（生成结果无漂移）通过 |

### 事实修正

`motion-spatial-plan.md` 原先把"Widget 卡片布局重排（FRUIT 拖拽改序）"列为待改造项。
按代码核对，该功能不存在：`git log -S 'FRUIT' --all` 只有一个命中，且是引入这句描述的
那次提交本身；全仓库也没有任何 Widget 卡片的拖拽改序布局。真实存在且存在同类问题的是
三处块列表（帧解码器 / 命令发送 / 协议 schema 编辑器），它们的排序与增删在本轮一并
接入。图表部分则判定为不需要改造，理由见文档。

这与上一轮修正的"控件调色板行"属同一类失真：文档描述了一个从未存在的功能，若不核实
就会照着它去实现。

### 设计取舍（记录理由，避免后续重复讨论）

**退场项不保留占位。** 计划文档此前把阻塞点写成"退出状态怎么暴露"，实测这个前提不成立：
对 FLIP 而言删除、插入、换序是同一件事 —— 只有槽位变了，缺席本身就是位移的来源。因此
退出项立即卸载即可，其余行各自从自己的旧槽位平滑让位，不需要保留占位、不需要延迟卸载、
也不需要任何额外状态去标记"谁正在退出"。

**触发条件只编码顺序。** 三处接入点的 trigger 都是块的 id 序列，不含展开状态。展开/收起
改变的是高度而非槽位，由块自身的尺寸过渡负责；把展开混进 trigger 会让 FLIP 与尺寸过渡
争夺同一批像素。

**只写 transform。** 让位是纯位移，块的高度在让位过程中不变（`FrameDecoder` 与
`ProtocolBlocksEditor` 在增删时都重置展开集合，正是因为展开态与列表结构不同源）。

### 求解缓存的量化

实测单次 `springFromTiming` 在 bouncy 令牌上约 192µs（40 次二分，每次内含一次最多 4096
采样的沉降扫描），`planRelease` 每次释放要解两次。缓存按量化后的时序为键：时长 0.1ms、
阻尼比 0.001 —— 两者都低于感知，且这些弹簧最终投影成毫秒分辨率的 CSS 令牌，量化不会
显形。量化的是**求解目标**而不只是缓存键，否则两个相差一个量化步的请求会拿到为不同
目标求解出的弹簧，取决于哪个先到。

缓存命中后 `pnpm docs:motion` 重新生成的调参表逐字节不变，确认量化没有移动任何令牌值。

## 遗留项

| # | 事项 | 依据 | 负责人 | 到期 |
| --- | --- | --- | --- | --- |
| 1 | 让位效果未做运行时目视验证：`pnpm dev:desktop` 未执行。让位读感（尤其纵向列表上 20–40px 的单格让位是否值得播）需真实确认 | 本记录「结论」 | 维护者 | 下次打开应用时 |
| 2 | 三处块列表的 FLIP 身份属性目前写作 `data-flip-key`，而拖拽逻辑已用 `data-block-id`。两者值相同但语义重复；若日后有第四处列表接入，应先决定是否统一为一个属性 | 本记录「范围」1 | 维护者 | 下一轮动效改动时 |
| 3 | 菜单项与时间线节点的错峰仍未做：菜单项只有 `motion-row`（悬停/按下过渡），本无进场动画，需先新写关键帧 | `motion-spatial-plan.md` 待改造节 | 维护者 | 下一轮 |
| 4 | 跨容器迁移（side ↔ bottom ↔ float）仍是瞬时，面板会真的跨组卸载重挂，FLIP 需在提交前捕获矩形、在新容器里重新落位 | `motion-spatial-plan.md` 未覆盖节 | 维护者 | 另行评估 |
| 5 | 节点编辑器（`@xyflow/react`）增删过渡仍未归一到家族令牌 | `motion-spatial-plan.md` 待改造节 | 维护者 | 下一轮 |