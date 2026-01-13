export { collection } from "$/server/collection";
export type { CollectionOptions } from "$/server/collection";
export type { ViewFunction } from "$/server/replicate";

// Migration types
export type {
	FieldType,
	SchemaDiffOperation,
	SchemaDiff,
	MigrationContext,
	MigrationDefinition,
	MigrationMap,
	SchemaDefinitionOptions,
	VersionedSchema,
	SchemaMigrations,
} from "$/server/migration";

import { table, prose } from "$/server/schema";
import { define } from "$/server/migration";

export const schema = {
	table,
	prose,
	define,
} as const;
