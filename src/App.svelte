<script>
  import { game } from './lib/store.svelte.js';
  import Lobby from './lib/Lobby.svelte';
  import GameRoom from './lib/GameRoom.svelte';

  let pendingRoomCode = $state('');

  $effect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      pendingRoomCode = hash;
    }
  });

</script>

<main>
  {#if game.connected}
    <GameRoom />
  {:else}
    <Lobby initialRoomCode={pendingRoomCode} />
  {/if}
</main>
