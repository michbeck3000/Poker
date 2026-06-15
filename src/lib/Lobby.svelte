<script>
  import { game, createRoom, joinRoom } from './store.svelte.js';

  let { initialRoomCode = '' } = $props();
  let joinCode = $state('');

  $effect(() => {
    if (initialRoomCode) joinCode = initialRoomCode;
  });

  function handleCreate() {
    if (game.myName.trim()) createRoom(game.myName.trim());
  }

  function handleJoin() {
    if (game.myName.trim() && joinCode.trim()) {
      joinRoom(game.myName.trim(), joinCode.trim().toUpperCase());
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') handleJoin();
  }
</script>

<div class="lobby">
  <div class="logo">🂡</div>
  <h1>Scrum Poker</h1>
  <p class="subtitle">Planning Poker für dein Team</p>

  <div class="card-input">
    <input
      type="text"
      placeholder="Dein Name"
      bind:value={game.myName}
    />

    <button class="btn btn-primary" onclick={handleCreate} disabled={!game.myName.trim() || game.connecting}>
      {game.connecting ? 'Verbinde...' : 'Raum erstellen'}
    </button>

    <div class="divider">
      <span>oder</span>
    </div>

    <div class="join-row">
      <input
        type="text"
        placeholder="Raum-Code"
        bind:value={joinCode}
        onkeydown={handleKeydown}
        maxlength="6"
      />
      <button class="btn btn-secondary" onclick={handleJoin} disabled={!game.myName.trim() || !joinCode.trim() || game.connecting}>
        {game.connecting ? 'Verbinde...' : 'Beitreten'}
      </button>
    </div>
  </div>

  {#if game.connecting}
    <p class="connecting-hint">Stelle Verbindung her...</p>
  {/if}

  {#if game.error}
    <p class="error">{game.error}</p>
  {/if}
</div>
