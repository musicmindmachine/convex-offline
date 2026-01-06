<script lang="ts">
  import { authClient } from "$lib/auth-client";
  import { useAuth } from "@mmailaender/convex-better-auth-svelte/svelte";
  import { Button } from "$lib/components/ui/button";
  import SignInDialog from "./SignInDialog.svelte";

  const auth = useAuth();
  const isAuthenticated = $derived(auth.isAuthenticated);
  const session = authClient.useSession();

  let showSignIn = $state(false);

  async function handleSignOut() {
    await authClient.signOut();
  }
</script>

<div class="flex items-center gap-2">
  {#if isAuthenticated && $session.data?.user}
    <span class="text-sm text-muted-foreground">
      {$session.data.user.email}
    </span>
    <Button variant="ghost" size="sm" onclick={handleSignOut}>
      Sign Out
    </Button>
  {:else}
    <Button variant="ghost" size="sm" onclick={() => showSignIn = true}>
      Sign In
    </Button>
  {/if}
</div>

<SignInDialog bind:open={showSignIn} />
