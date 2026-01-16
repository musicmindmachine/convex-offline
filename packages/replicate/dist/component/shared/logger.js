import { getLogger } from "@logtape/logtape";

//#region src/shared/logger.ts
const PROJECT_NAME = "replicate";
function getLogger$1(category) {
	return getLogger([PROJECT_NAME, ...category]);
}

//#endregion
export { getLogger$1 as getLogger };
//# sourceMappingURL=logger.js.map