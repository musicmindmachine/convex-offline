import type { ConvexClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { getLogger } from "$/client/logger";

const logger = getLogger(["replicate", "cursor"]);

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

interface CursorTrackerApi {
  mark: FunctionReference<"mutation">;
  cursors: FunctionReference<"query">;
  leave: FunctionReference<"mutation">;
}

interface CursorTrackerConfig {
  convexClient: ConvexClient;
  api: CursorTrackerApi;
  collection: string;
  document: string;
  client: string;
  field: string;
  user?: string;
  profile?: UserProfile;
  heartbeatInterval?: number;
}

const DEFAULT_HEARTBEAT_INTERVAL = 10000;

export class CursorTracker {
  private position: CursorPosition | null = null;
  private remoteClients = new Map<string, ClientCursor>();
  private convexClient: ConvexClient;
  private api: CursorTrackerApi;
  private collection: string;
  private document: string;
  private client: string;
  private field: string;
  private user?: string;
  private profile?: UserProfile;
  private heartbeatInterval: number;
  private unsubscribe?: () => void;
  private listeners = new Set<() => void>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private startTimeout: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(config: CursorTrackerConfig) {
    this.convexClient = config.convexClient;
    this.api = config.api;
    this.collection = config.collection;
    this.document = config.document;
    this.client = config.client;
    this.field = config.field;
    this.user = config.user;
    this.profile = config.profile;
    this.heartbeatInterval = config.heartbeatInterval ?? DEFAULT_HEARTBEAT_INTERVAL;

    this.subscribeToServer();
    this.startTimeout = setTimeout(() => {
      if (!this.destroyed) {
        this.startHeartbeat();
      }
    }, 0);

    logger.debug("CursorTracker created", {
      collection: this.collection,
      document: this.document,
      client: this.client,
      field: this.field,
    });
  }

  get(): CursorPosition | null {
    return this.position;
  }

  update(position: Omit<CursorPosition, "field">): void {
    this.position = { ...position, field: this.field };
    this.sendHeartbeat();
  }

  others(): Map<string, ClientCursor> {
    return new Map(this.remoteClients);
  }

  on(event: "change", cb: () => void): void {
    if (event === "change") {
      this.listeners.add(cb);
    }
  }

  off(event: "change", cb: () => void): void {
    if (event === "change") {
      this.listeners.delete(cb);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    logger.debug("CursorTracker destroying", {
      collection: this.collection,
      document: this.document,
    });

    if (this.startTimeout) {
      clearTimeout(this.startTimeout);
      this.startTimeout = null;
    }
    this.stopHeartbeat();
    this.unsubscribe?.();
    this.listeners.clear();

    if (this.heartbeatTimer) {
      this.convexClient.mutation(this.api.leave, {
        document: this.document,
        client: this.client,
      }).catch((error) => {
        logger.warn("Leave mutation failed", { error: String(error) });
      });
    }
  }

  private startHeartbeat(): void {
    this.sendHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private sendHeartbeat(): void {
    if (this.destroyed) return;

    this.convexClient.mutation(this.api.mark, {
      document: this.document,
      client: this.client,
      cursor: this.position ?? undefined,
      user: this.user,
      profile: this.profile,
      interval: this.heartbeatInterval,
    }).catch((error) => {
      logger.warn("Heartbeat failed", { error: String(error) });
    });
  }

  private subscribeToServer(): void {
    this.unsubscribe = this.convexClient.onUpdate(
      this.api.cursors,
      {
        document: this.document,
        exclude: this.client,
      },
      (clients: ClientCursor[]) => {
        this.remoteClients.clear();
        for (const c of clients) {
          this.remoteClients.set(c.client, c);
        }
        this.notifyListeners();
      },
    );
  }

  private notifyListeners(): void {
    for (const cb of this.listeners) {
      try {
        cb();
      }
      catch (error) {
        logger.warn("Cursor change listener error", { error: String(error) });
      }
    }
  }
}
