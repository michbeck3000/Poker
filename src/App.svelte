<script>
  import { game, joinRoom, leaveRoom } from './lib/store.svelte.js';
  import Lobby from './lib/Lobby.svelte';
  import GameRoom from './lib/GameRoom.svelte';

  let pendingRoomCode = $state('');

  $effect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      const stored = localStorage.getItem('scrumPokerName');
      if (stored) {
        game.myName = stored;
        joinRoom(stored, hash, game.myId);
      } else {
        pendingRoomCode = hash;
      }
    }
  });

  $effect(() => {
    if (game.myName && game.connected) {
      localStorage.setItem('scrumPokerName', game.myName);
    }
  });

  $effect(() => {
    const handler = () => {
      if (game.roomId && game.myId) {
        leaveRoom();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  });
</script>

<main>
  {#if game.connected}
    <GameRoom />
  {:else}
    <Lobby initialRoomCode={pendingRoomCode} />
  {/if}
</main>
