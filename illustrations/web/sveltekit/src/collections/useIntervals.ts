import { browser } from "$app/environment";
import { createCollection, type Collection } from "@tanstack/db";
import {
  convexCollectionOptions,
  persistence,
  type EditorBinding,
  type Persistence,
} from "@trestleinc/replicate/client";
import { api } from "$convex/_generated/api";
import { intervalSchema, type Interval } from "$lib/types";
import { getConvexClient } from "$lib/convex";
import initSqlJs from "sql.js";

type IntervalsCollection = Collection<Interval> & {
  utils: {
    prose(documentId: string, field: "description"): Promise<EditorBinding>;
  };
  singleResult?: never;
};

let intervalsCollection: IntervalsCollection | null = null;
let intervalsPersistence: Persistence | null = null;

export async function initIntervalsPersistence(): Promise<Persistence> {
  if (intervalsPersistence) return intervalsPersistence;

  const SQL = await initSqlJs({
    locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
  });
  intervalsPersistence = await persistence.sqlite.browser(SQL, "intervals");
  return intervalsPersistence;
}

export function useIntervals(): IntervalsCollection {
  if (!browser) {
    throw new Error("useIntervals can only be used in browser");
  }
  if (!intervalsPersistence) {
    throw new Error("Call initIntervalsPersistence() before useIntervals()");
  }
  if (!intervalsCollection) {
    const convexClient = getConvexClient();
    intervalsCollection = createCollection(
      convexCollectionOptions({
        schema: intervalSchema,
        convexClient,
        api: api.intervals,
        getKey: (interval: Interval) => interval.id,
        persistence: intervalsPersistence,
      }),
    ) as unknown as IntervalsCollection;
  }
  return intervalsCollection;
}

export type { Interval } from "$lib/types";
