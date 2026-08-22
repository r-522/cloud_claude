// File: src/models.ts
/**
 * モデル定義。
 *
 * 一次情報（Anthropic公式ドキュメント / claude-apiスキルのキャッシュ）に基づく:
 *  - Models overview: platform.claude.com/docs/en/about-claude/models/overview
 *  - Effort: platform.claude.com/docs/en/build-with-claude/effort
 *
 * Haiku 4.5 / Sonnet 5 / Opus 5 はいずれも公式に提供されているモデルであり、
 * 要件どおりのモデル名をそのまま使用する（偽装や別モデルへの置き換えは行わない）。
 *
 * effort（推論量）:
 *  - `output_config.effort` はGA機能でベータヘッダー不要。
 *  - Haiku 4.5 / Opus 5 / Sonnet 5 はいずれも low/medium/high/xhigh/max の全レベルに対応。
 *  - Opus 5 / Sonnet 5 は思考（thinking）がデフォルトで有効（adaptive）であり、
 *    本アプリでは明示的に thinking を無効化しない（無効化はeffort次第で400になる
 *    組み合わせが存在するため、意図的に触れない）。
 */

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export const EFFORT_LEVELS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];

export interface ModelDef {
  id: string;
  label: string;
  description: string;
  supportsEffort: boolean;
}

export const MODELS: readonly ModelDef[] = [
  {
    id: "claude-haiku-4-5",
    label: "Haiku 4.5",
    description: "高速・低コスト",
    supportsEffort: true,
  },
  {
    id: "claude-sonnet-5",
    label: "Sonnet 5",
    description: "バランス型",
    supportsEffort: true,
  },
  {
    id: "claude-opus-5",
    label: "Opus 5",
    description: "最高性能",
    supportsEffort: true,
  },
] as const;

export function findModel(id: unknown): ModelDef | undefined {
  if (typeof id !== "string") return undefined;
  return MODELS.find((m) => m.id === id);
}

export function isValidEffort(value: unknown): value is EffortLevel {
  return typeof value === "string" && (EFFORT_LEVELS as string[]).includes(value);
}

export function publicModelList(): Array<Pick<ModelDef, "id" | "label" | "description" | "supportsEffort">> {
  return MODELS.map(({ id, label, description, supportsEffort }) => ({
    id,
    label,
    description,
    supportsEffort,
  }));
}
