<script>
  import { game, joinRoom } from './lib/store.svelte.js';
  import Lobby from './lib/Lobby.svelte';
  import GameRoom from './lib/GameRoom.svelte';

  let pendingRoomCode = $state('');

  $effect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      const stored = sessionStorage.getItem('scrumPokerName');
      if (stored) {
        game.myName = stored;
        joinRoom(stored, hash);
      } else {
        pendingRoomCode = hash;
      }
    }
  });

  $effect(() => {
    if (game.myName && game.connected) {
      sessionStorage.setItem('scrumPokerName', game.myName);
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
