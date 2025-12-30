export { collection } from "$/server/builder";
export type { CollectionOptions } from "$/server/builder";

import { table, prose } from "$/server/schema";

export const schema = {
  table,
  prose,
} as const;
