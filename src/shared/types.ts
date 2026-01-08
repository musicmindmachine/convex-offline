import { type ProseValue } from "./validators.js";

export { type ProseValue };

export interface FragmentValue {
	__xmlFragment: true;
	content?: XmlFragmentJSON;
}

export interface XmlFragmentJSON {
	type: "doc";
	content?: XmlNodeJSON[];
}

export interface XmlNodeJSON {
	type: string;
	attrs?: Record<string, unknown>;
	content?: XmlNodeJSON[];
	text?: string;
	marks?: { type: string; attrs?: Record<string, unknown> }[];
}

/** Operation type for streaming changes */
export enum OperationType {
	Delta = "delta",
	Snapshot = "snapshot",
}

/**
 * Extract prose field names from T (fields typed as ProseValue).
 * Used internally for type-safe prose field operations.
 */
export type ProseFields<T> = {
	[K in keyof T]: T[K] extends ProseValue ? K : never;
}[keyof T];

type DurationUnit = "m" | "h" | "d";
export type Duration = `${number}${DurationUnit}`;

export interface CompactionConfig {
	threshold?: number;
	timeout?: Duration;
	retain?: number;
}

const DURATION_MULTIPLIERS: Record<DurationUnit, number> = {
	m: 60_000,
	h: 3_600_000,
	d: 86_400_000,
};

export function parseDuration(s: Duration): number {
	const match = /^(\d+)(m|h|d)$/i.exec(s);
	if (!match) throw new Error(`Invalid duration: ${s}`);
	const [, num, unit] = match;
	return parseInt(num) * DURATION_MULTIPLIERS[unit.toLowerCase() as DurationUnit];
}
