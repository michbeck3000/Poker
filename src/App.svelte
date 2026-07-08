<script>
  import { game, joinRoom, sendLeaveBeacon } from './lib/store.svelte.js';
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
    const handler = () => {
      sendLeaveBeacon();
      localStorage.removeItem('scrumPokerRoom');
    };
    window.addEventListener('pagehide', handler);
    return () => window.removeEventListener('pagehide', handler);
  });
</script>

<main>
  {#if game.connected}
    <GameRoom />
  {:else}
    <Lobby initialRoomCode={pendingRoomCode} />
  {/if}
</main>
