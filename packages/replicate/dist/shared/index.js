import { v } from "convex/values";
import { getLogger as getLogger$1 } from "@logtape/logtape";

//#region src/shared/logger.ts
const PROJECT_NAME = "replicate";
function getLogger(category) {
	return getLogger$1([PROJECT_NAME, ...category]);
}

//#endregion
//#region src/shared/index.ts
/**
* @trestleinc/replicate - Shared Module
*
* Single source of truth for all validators, types, and utilities.
*
* Following the val.md pattern:
* 1. All validators defined here
* 2. Types derived from validators using Infer<>
* 3. No duplicate interfaces - types come from validators
*/
/**
* Profile validator for user presence/identity.
* Used in sessions and presence tracking.
*/
const profileValidator = v.object({
	name: v.optional(v.string()),
	color: v.optional(v.string()),
	avatar: v.optional(v.string())
});
/**
* Cursor validator for collaborative editing positions.
* Tracks anchor/head selection positions and optional field context.
*/
const cursorValidator = v.object({
	anchor: v.any(),
	head: v.any(),
	field: v.optional(v.string())
});
/**
* Prose validator for ProseMirror-compatible rich text JSON.
* Used for collaborative rich text editing fields.
*/
const proseValidator = v.object({
	type: v.literal("doc"),
	content: v.optional(v.array(v.any()))
});
/**
* Individual change in a stream response.
*/
const streamChangeValidator = v.object({
	document: v.string(),
	bytes: v.bytes(),
	seq: v.number(),
	type: v.string()
});
/**
* Extended stream change with existence flag (used in server responses).
*/
const streamChangeWithExistsValidator = v.object({
	document: v.string(),
	bytes: v.bytes(),
	seq: v.number(),
	type: v.string(),
	exists: v.boolean()
});
/**
* Stream query result with changes, cursor, and compaction hints.
*/
const streamResultValidator = v.object({
	changes: v.array(streamChangeValidator),
	seq: v.number(),
	more: v.boolean(),
	compact: v.optional(v.object({ documents: v.array(v.string()) }))
});
/**
* Stream result with exists flag on changes (server-enriched response).
*/
const streamResultWithExistsValidator = v.object({
	changes: v.array(streamChangeWithExistsValidator),
	seq: v.number(),
	more: v.boolean(),
	compact: v.optional(v.object({ documents: v.array(v.string()) }))
});
/**
* Session record for presence tracking.
* Returned by sessions query.
*/
const sessionValidator = v.object({
	client: v.string(),
	document: v.string(),
	user: v.optional(v.string()),
	profile: v.optional(v.any()),
	cursor: v.optional(cursorValidator),
	seen: v.number()
});
/**
* Presence action (join or leave).
* @deprecated Use sessionActionValidator instead
*/
const presenceActionValidator = v.union(v.literal("join"), v.literal("leave"));
/**
* Replicate mutation type - combines insert/update/delete.
*/
const replicateTypeValidator = v.union(v.literal("insert"), v.literal("update"), v.literal("delete"));
/**
* Session action - combines presence (join/leave) and mark (mark/signal).
*/
const sessionActionValidator = v.union(v.literal("join"), v.literal("leave"), v.literal("mark"), v.literal("signal"));
/**
* Standard success/seq result for insert/update/delete mutations.
*/
const successSeqValidator = v.object({
	success: v.boolean(),
	seq: v.number()
});
/**
* Compaction result with statistics.
*/
const compactResultValidator = v.object({
	success: v.boolean(),
	removed: v.number(),
	retained: v.number(),
	size: v.number()
});
/**
* Recovery query result with optional diff and state vector.
*/
const recoveryResultValidator = v.object({
	diff: v.optional(v.bytes()),
	vector: v.bytes()
});
/**
* Document state result (for SSR/hydration).
*/
const documentStateValidator = v.union(v.object({
	bytes: v.bytes(),
	seq: v.number()
}), v.null());
/**
* SSR material query result (non-paginated, backward compatible).
*/
const materialResultValidator = v.object({
	documents: v.any(),
	count: v.number(),
	crdt: v.optional(v.record(v.string(), v.object({
		bytes: v.bytes(),
		seq: v.number()
	}))),
	cursor: v.optional(v.number())
});
/** Operation type for streaming changes */
let OperationType = /* @__PURE__ */ function(OperationType$1) {
	OperationType$1["Delta"] = "delta";
	OperationType$1["Snapshot"] = "snapshot";
	return OperationType$1;
}({});
const DURATION_MULTIPLIERS = {
	m: 6e4,
	h: 36e5,
	d: 864e5
};
function parseDuration(s) {
	const match = /^(\d+)(m|h|d)$/i.exec(s);
	if (!match) throw new Error(`Invalid duration: ${s}`);
	const [, num, unit] = match;
	return parseInt(num) * DURATION_MULTIPLIERS[unit.toLowerCase()];
}

//#endregion
export { OperationType, compactResultValidator, cursorValidator, documentStateValidator, getLogger, materialResultValidator, parseDuration, presenceActionValidator, profileValidator, proseValidator, recoveryResultValidator, replicateTypeValidator, sessionActionValidator, sessionValidator, streamChangeValidator, streamChangeWithExistsValidator, streamResultValidator, streamResultWithExistsValidator, successSeqValidator };
//# sourceMappingURL=index.js.map