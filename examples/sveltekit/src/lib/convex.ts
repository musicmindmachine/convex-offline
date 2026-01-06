import { ConvexClient } from "convex/browser";
import { PUBLIC_CONVEX_URL } from "$env/static/public";

// Shared ConvexClient - auth is configured by createSvelteAuthClient in +layout.svelte
export const convexClient = new ConvexClient(PUBLIC_CONVEX_URL);
