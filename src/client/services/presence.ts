import * as Y from "yjs";
import { Effect, Context, Layer } from "effect";
import type { ConvexClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import type { SubdocManager } from "$/client/subdocs";
import { getLogger } from "$/client/logger";

const logger = getLogger(["replicate", "presence"]);

const DEFAULT_HEARTBEAT_INTERVAL = 10000;
const DEFAULT_CURSOR_THROTTLE_MS = 50;

export interface CursorPosition {
  anchor: number;
  head: number;
  field?: string;
}

export interface UserProfile {
  name?: string;
  color?: string;
  avatar?: string;
}

export interface ClientCursor {
  client: string;
  user?: string;
  profile?: UserProfile;
  cursor: CursorPosition;
}

interface PresenceApi {
  mark: FunctionReference<"mutation">;
  cursors: FunctionReference<"query">;
  leave: FunctionReference<"mutation">;
}

export interface PresenceConfig {
  convexClient: ConvexClient;
  api: PresenceApi;
  collection: string;
  document: string;
  client: string;
  field: string;
  subdocManager: SubdocManager;
  user?: string;
  profile?: UserProfile;
  interval?: number;
}

export class Presence extends Context.Tag("Presence")<
  Presence,
  {
    readonly get: () => CursorPosition | null;
    readonly update: (position: Omit<CursorPosition, "field">) => void;
    readonly others: () => Map<string, ClientCursor>;
    readonly on: (event: "change", cb: () => void) => void;
    readonly off: (event: "change", cb: () => void) => void;
    readonly destroy: () => void;
  }
>() {}

export function createPresenceLayer(config: PresenceConfig) {
  return Layer.sync(Presence, () => {
    let position: CursorPosition | null = null;
    const remoteClients = new Map<string, ClientCursor>();
    const listeners = new Set<() => void>();
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let startTimeout: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;
    let visible = true;
    let pendingCursorUpdate: ReturnType<typeof setTimeout> | null = null;
    let unsubscribe: (() => void) | undefined;
    let unsubscribeVisibility: (() => void) | undefined;

    const {
      convexClient,
      api,
      collection,
      document,
      client,
      field,
      subdocManager,
      user,
      profile,
      interval = DEFAULT_HEARTBEAT_INTERVAL,
    } = config;

    const getVector = (): ArrayBuffer | undefined => {
      const subdoc = subdocManager.get(document);
      return subdoc
        ? Y.encodeStateVector(subdoc).buffer as ArrayBuffer
        : undefined;
    };

    const sendHeartbeat = () => {
      if (destroyed) return;

      const vector = getVector();
      const cursor = visible ? (position ?? undefined) : undefined;

      convexClient.mutation(api.mark, {
        document,
        client,
        cursor,
        user,
        profile,
        interval,
        vector,
      }).catch((error) => {
        logger.warn("Heartbeat failed", { error: String(error) });
      });
    };

    const clearCursorOnServer = () => {
      if (destroyed) return;

      const vector = getVector();
      convexClient.mutation(api.mark, {
        document,
        client,
        cursor: undefined,
        user,
        profile,
        interval,
        vector,
      }).catch((error) => {
        logger.warn("Clear cursor failed", { error: String(error) });
      });
    };

    const setupVisibilityHandler = () => {
      if (typeof globalThis.document === "undefined") return;

      const handler = () => {
        const wasVisible = visible;
        visible = globalThis.document.visibilityState === "visible";

        if (wasVisible && !visible) {
          clearCursorOnServer();
        }
        else if (!wasVisible && visible && position) {
          sendHeartbeat();
        }
      };

      globalThis.document.addEventListener("visibilitychange", handler);
      unsubscribeVisibility = () => {
        globalThis.document.removeEventListener("visibilitychange", handler);
      };
    };

    const subscribeToServer = () => {
      unsubscribe = convexClient.onUpdate(
        api.cursors,
        { document, exclude: client },
        (clients: ClientCursor[]) => {
          remoteClients.clear();
          for (const c of clients) {
            remoteClients.set(c.client, c);
          }
          notifyListeners();
        },
      );
    };

    const notifyListeners = () => {
      for (const cb of listeners) {
        try {
          cb();
        }
        catch (error) {
          logger.warn("Cursor change listener error", { error: String(error) });
        }
      }
    };

    const startHeartbeat = () => {
      sendHeartbeat();
      heartbeatTimer = setInterval(sendHeartbeat, interval);
    };

    const stopHeartbeat = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };

    const throttledSendCursor = () => {
      if (pendingCursorUpdate) return;

      pendingCursorUpdate = setTimeout(() => {
        pendingCursorUpdate = null;
        if (!destroyed && visible) {
          sendHeartbeat();
        }
      }, DEFAULT_CURSOR_THROTTLE_MS);
    };

    subscribeToServer();
    setupVisibilityHandler();
    startTimeout = setTimeout(() => {
      if (!destroyed) {
        startHeartbeat();
      }
    }, 0);

    logger.debug("Presence created", { collection, document, client, field });

    return Presence.of({
      get: () => position,

      update: (pos) => {
        position = { ...pos, field };
        throttledSendCursor();
      },

      others: () => new Map(remoteClients),

      on: (event, cb) => {
        if (event === "change") {
          listeners.add(cb);
        }
      },

      off: (event, cb) => {
        if (event === "change") {
          listeners.delete(cb);
        }
      },

      destroy: () => {
        if (destroyed) return;
        destroyed = true;

        logger.debug("Presence destroying", { collection, document });

        if (startTimeout) {
          clearTimeout(startTimeout);
          startTimeout = null;
        }
        if (pendingCursorUpdate) {
          clearTimeout(pendingCursorUpdate);
          pendingCursorUpdate = null;
        }
        stopHeartbeat();
        unsubscribe?.();
        unsubscribeVisibility?.();
        listeners.clear();

        if (heartbeatTimer) {
          convexClient.mutation(api.leave, { document, client }).catch((error) => {
            logger.warn("Leave mutation failed", { error: String(error) });
          });
        }
      },
    });
  });
}

export function createPresence(config: PresenceConfig) {
  return Effect.runSync(
    Effect.gen(function* () {
      return yield* Presence;
    }).pipe(Effect.provide(createPresenceLayer(config))),
  );
}
