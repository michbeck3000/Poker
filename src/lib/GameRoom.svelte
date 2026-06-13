<script>
  import { game, CARD_VALUES, selectCard, revealCards, newRound, leaveRoom } from './store.svelte.js';

  let copied = $state(false);
  let showLeaveConfirm = $state(false);
  let flipDelays = $state({});

  function shuffleDelays() {
    const delays = game.players.map((_, i) => i * 80);
    for (let i = delays.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [delays[i], delays[j]] = [delays[j], delays[i]];
    }
    const map = {};
    game.players.forEach((p, i) => { map[p.id] = delays[i]; });
    flipDelays = map;
  }

  let gridCols = $derived.by(() => {
    const n = game.players.length;
    if (n <= 4) return n || 1;
    if (n <= 6) return 3;
    return 4;
  });

  $effect(() => {
    if (game.phase === 'revealed') {
      shuffleDelays();
    }
  });

  function handleLeave() {
    if (game.isHost && game.players.length > 1) {
      showLeaveConfirm = true;
    } else {
      leaveRoom();
    }
  }

  function confirmLeave() {
    showLeaveConfirm = false;
    leaveRoom();
  }

  function cancelLeave() {
    showLeaveConfirm = false;
  }

  function average() {
    const vals = Object.values(game.revealedCards).filter(v => typeof v === 'number');
    if (vals.length === 0) return '-';
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  }

  function getPlayerName(id) {
    return game.players.find(p => p.id === id)?.name || '?';
  }

  function copyRoomLink() {
    const url = `${window.location.origin}${window.location.pathname}#${game.roomId}`;
    navigator.clipboard.writeText(url).then(() => {
      copied = true;
      setTimeout(() => copied = false, 2000);
    });
  }
</script>

<div class="game-room">
  <header>
    <div class="room-info">
      <h2>Raum: <strong>{game.roomId}</strong></h2>
      <button class="btn btn-small btn-outline" onclick={copyRoomLink}>
        {copied ? '✓ Kopiert!' : 'Link kopieren'}
      </button>
    </div>
    <button class="btn btn-small btn-danger" onclick={handleLeave}>
      {game.isHost ? 'Raum schließen' : 'Verlassen'}
    </button>
  </header>

  <div class="player-list" style="grid-template-columns: repeat({gridCols}, auto)">
    {#each game.players as player, i (player.id)}
      <div
        class="player"
        class:me={player.id === game.myId}
        class:flipped={game.phase === 'revealed'}
        style="--delay: {flipDelays[player.id] ?? 0}ms"
      >
        <div class="card-inner">
          <div class="card-front">
            <span class="name">{player.name}</span>
            <span class="status" class:ready={player.hasVoted}>
              {player.hasVoted ? '✓ Bereit' : 'Wählt...'}
            </span>
          </div>
          <div class="card-back">
            <span class="revealed-value">{game.revealedCards[player.id] ?? '-'}</span>
            <span class="name">{player.name}</span>
          </div>
        </div>
      </div>
    {/each}
  </div>

  {#if game.phase === 'voting'}
    <div class="card-deck">
      {#each CARD_VALUES as value}
        <button
          class="poker-card"
          class:selected={game.selectedCard === value}
          onclick={() => selectCard(value)}
        >
          <span class="card-value">{value}</span>
        </button>
      {/each}
    </div>

    {#if !game.selectedCard && game.selectedCard !== 0}
      <p class="hint">Wähle eine Karte aus, um abzustimmen</p>
    {:else}
      <p class="selected-hint">Ausgewählt: <strong>{game.selectedCard}</strong></p>
    {/if}

    {#if game.isHost}
      <button class="btn btn-reveal" onclick={revealCards}>
        Aufdecken
      </button>
    {/if}
  {:else}
    <div class="results">
      <p class="average">Durchschnitt: <strong>{average()}</strong></p>
      {#if game.isHost}
        <button class="btn btn-primary" onclick={newRound}>
          Neue Runde
        </button>
      {/if}
    </div>
  {/if}
</div>

{#if showLeaveConfirm}
  <div class="overlay" onclick={cancelLeave} onkeydown={(e) => e.key === 'Escape' && cancelLeave()} role="button" tabindex="0">
    <div class="confirm-dialog" role="dialog" aria-labelledby="confirm-title">
      <h3 id="confirm-title">Raum wirklich schließen?</h3>
      <p>Alle verbundenen Spieler werden getrennt.</p>
      <div class="confirm-actions">
        <button class="btn btn-secondary" onclick={cancelLeave}>Abbrechen</button>
        <button class="btn btn-danger" onclick={confirmLeave}>Schließen</button>
      </div>
    </div>
  </div>
{/if}
