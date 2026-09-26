// ============ 协议帧 schema ============
//
// 协议 = 一份帧 schema: decode 块列表 (解析) + 可选 encode 块列表 (编码)。
// 所有现有协议 kind (JustFloat/FireWater/RawData/Slcan/CandleLight/LogicDecode)
// 都是 schema 的预设; 用户编辑块后 preset='custom', 走后端 SchemaEngine。
//
// wire 类型由 Rust schema_types crate 生成 (src/types/generated/, check:contracts
// 阻止漂移), 本文件只做 re-export; 禁止手写 wire 镜像。

// schema 预设 ("justFloat"/"fireWater"/.../"custom", serde rename_all="camelCase")
export type { SchemaPreset } from './generated/SchemaPreset';

// 编码块定义 (serde tag="type" content="params" + camelCase)。
// 注意: 与前端 CommandBlock 形状不同 (CommandBlock 为平铺 snake_case 块类型),
// 两者不强行复用; 需要互转时在 lib/utils 中建映射函数。
export type { EncodeBlockDef as EncodeBlock } from './generated/EncodeBlockDef';

// 协议帧 schema — preset / legacyConfig (custom 时省略) / decode / encode
export type { ProtocolSchema } from './generated/ProtocolSchema';

// 解码块定义 (tag="type" 字段平铺); 前端历史命名保留。
// FieldType 仍由 frameDecoder.ts 提供 (与 wire 逐字一致)。
export type { DecoderBlockDef as DecoderBlockWire } from './generated/DecoderBlockDef';
