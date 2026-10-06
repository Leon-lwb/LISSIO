# Lissio 路线图

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: zh-CN
authoritative: false
translation-of: ROADMAP.md
applies-to: Non-authoritative Chinese translation backup
-->

> 中文翻译备份；对应的英文源文件为权威版本。若中英文不一致，以英文为准。
> Chinese translation backup. The English source is authoritative; English controls in case of conflict.

本路线图记录已交付范围和具体后续事项，不是交付日期承诺。实现事实以代码、测试和发布
产物为准。

## 已交付

Lissio 当前提供串口、TCP、UDP、测试信号、Slcan、CandleLight 与工业点位采集；波形、
RawData、CAN、逻辑、命令帧、诊断与录制；节点图、DSP、FFT、帧解码与沙箱 JavaScript；
桌面、Web、独立服务端、CLI、MCP 与内置 AI；以及架构、依赖、契约、目录、令牌、动效、
文档、性能和许可门禁。

## 发布与合规事项

| 优先级 | 事项 | 验收 |
| --- | --- | --- |
| 1 | 二进制包含 `LICENSE`、`NOTICE` 和第三方文本 | 各交付形态实际包含或可达 |
| 2 | 打包字体许可文本 | 含字体的桌面、Web 与镜像均包含 |
| 3 | 解决 MiSans 子集化问题 | 有书面结论，不允许时替换字体 |
| 4 | 发布校验和与源码链接 | 发布记录含源码 revision 与产物 hash |
| 5 | 历史 GPL 表述准确 | 当前 Apache 版本与历史 GPL 发布物明确区分 |

Apache-2.0 允许商业使用和闭源衍生品。Lissio 不销售独立商业许可证。

## 发布卫生

统一历史 tag；文档、manifest、About 与 `git remote` 均以 Codeberg 为权威；发布记录包含
源码 revision、产物、校验和与验证结果。

## 其他方向

工业协议必须通过许可、依赖、跨平台、互操作与故障恢复审查。硬件验证需覆盖 USB 串口、
CAN、Modbus、S7、断线、时钟漂移、坏帧与长时运行。基准需覆盖波形摄入、图求值、录制和
全链路。

治理上在合适人选出现时补充第二位维护者或委派评审人。在此之前公开单维护者响应限制。

## 明确不承诺

不承诺安全认证、硬实时、全部 PLC、任意硬件驱动、无限历史兼容、法律意见或合同支持。
