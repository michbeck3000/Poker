<script>
  import { game, CARD_VALUES, selectCard, revealCards, newRound, leaveRoom } from './store.svelte.js';

  let copied = $state(false);
  let flipDelays = $state({});
  let marqueeActive = $state({});

  const THROW_EMOJIS = ['🎯', '💩', '🔥', '❤️', '🎉', '⭐', '💀', '👑', '🌈', '🍕'];

  let hoveringPlayerId = $state(null);
  let emojiPickerPos = $state({ x: 0, y: 0 });
  let pickerAbove = $state(true);
  let hideTimeout = null;

  function onPlayerEnter(playerId, e) {
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    if (rect.top < 60) {
      pickerAbove = false;
      emojiPickerPos = { x, y: rect.bottom + 10 };
    } else {
      pickerAbove = true;
      emojiPickerPos = { x, y: rect.top - 10 };
    }
    hoveringPlayerId = playerId;
  }

  function onPlayerLeave(e) {
    hideTimeout = setTimeout(() => { hoveringPlayerId = null; }, 200);
  }

  function onPickerEnter() {
    if (hideTimeout) { clearTimeout(hideTimeout); hideTimeout = null; }
  }

  function onPickerLeave() {
    hoveringPlayerId = null;
  }

  function throwEmoji(emoji, playerId) {
    hoveringPlayerId = null;
    const playerEl = document.querySelector(`[data-player-id="${playerId}"]`);
    if (!playerEl) return;

    const playerRect = playerEl.getBoundingClientRect();
    const endX = playerRect.left + playerRect.width / 2;
    const endY = playerRect.top + playerRect.height / 2;

    const side = Math.floor(Math.random() * 4);
    let startX, startY;
    switch (side) {
      case 0: startX = Math.random() * window.innerWidth; startY = -60; break;
      case 1: startX = window.innerWidth + 60; startY = Math.random() * window.innerHeight; break;
      case 2: startX = Math.random() * window.innerWidth; startY = window.innerHeight + 60; break;
      case 3: startX = -60; startY = Math.random() * window.innerHeight; break;
    }

    const midX = (startX + endX) / 2;
    const ctrlX = midX + (Math.random() - 0.5) * 300;
    const ctrlY = Math.min(startY, endY) - 150 - Math.random() * 100;

    const el = document.createElement('div');
    el.textContent = emoji;
    el.style.cssText = 'position:fixed;left:0;top:0;font-size:36px;pointer-events:none;z-index:9999;line-height:1;';
    document.body.appendChild(el);

    const duration = 700 + Math.random() * 400;
    const startTime = performance.now();
    const rAF = requestAnimationFrame;

    function animate(time) {
      const t = Math.min((time - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      const x = (1 - ease) * (1 - ease) * startX + 2 * (1 - ease) * ease * ctrlX + ease * ease * endX;
      const y = (1 - ease) * (1 - ease) * startY + 2 * (1 - ease) * ease * ctrlY + ease * ease * endY;
      const scale = 1 + (1 - t) * 0.5;
      el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;

      if (t < 1) {
        rAF(animate);
      } else {
        el.remove();
      }
    }
    rAF(animate);
  }

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

  function isTruncated(el) {
    return el && el.scrollWidth > el.clientWidth;
  }

  $effect(() => {
    const interval = setInterval(() => {
      const wraps = document.querySelectorAll('.card-front .name-wrap');
      wraps.forEach((wrap, i) => {
        if (game.players[i]) {
          marqueeActive[game.players[i].id] = isTruncated(wrap);
        }
      });
      setTimeout(() => {
        game.players.forEach(p => { marqueeActive[p.id] = false; });
      }, 8000);
    }, 20000);
    return () => clearInterval(interval);
  });

  function average() {
    const vals = Object.values(game.revealedCards).filter(v => typeof v === 'number');
    if (vals.length === 0) return '-';
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
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
    <button class="btn btn-small btn-danger" onclick={leaveRoom}>
      Verlassen
    </button>
  </header>

  <div class="game-content">
    <div class="player-list" style="grid-template-columns: repeat({gridCols}, auto)">
      {#each game.players as player, i (player.id)}
        <div
          class="player"
          class:me={player.id === game.myId}
          class:flipped={game.phase === 'revealed'}
          style="--delay: {flipDelays[player.id] ?? 0}ms"
          data-player-id={player.id}
          role="group"
          onmouseenter={(e) => onPlayerEnter(player.id, e)}
          onmouseleave={onPlayerLeave}
        >
          <div class="card-inner">
            <div class="card-front">
              <span class="name-wrap">
                <span class="name" class:marquee={marqueeActive[player.id]}>{player.name}</span>
              </span>
              <span class="status" class:ready={player.hasVoted}>
                {player.hasVoted ? '✓ Bereit' : 'Wählt...'}
              </span>
            </div>
            <div class="card-back">
              <span class="revealed-value">{game.revealedCards[player.id] ?? '-'}</span>
              <span class="name-wrap">
                <span class="name" class:marquee={marqueeActive[player.id]}>{player.name}</span>
              </span>
            </div>
          </div>
        </div>
      {/each}
    </div>

    {#if hoveringPlayerId !== null}
      <div
        class="emoji-picker"
        class:below={!pickerAbove}
        style="left: {emojiPickerPos.x}px; top: {emojiPickerPos.y}px;"
        role="group"
        onmouseenter={onPickerEnter}
        onmouseleave={onPickerLeave}
      >
        {#each THROW_EMOJIS as emoji}
          <button class="flying-emoji-btn" onclick={() => throwEmoji(emoji, hoveringPlayerId)}>
            {emoji}
          </button>
        {/each}
      </div>
    {/if}

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

      <button class="btn btn-reveal" onclick={revealCards}>
        Aufdecken
      </button>
    {:else}
      <div class="results">
        <p class="average">Durchschnitt: <strong>{average()}</strong></p>
        <button class="btn btn-primary" onclick={newRound}>
          Neue Runde
        </button>
      </div>
    {/if}
  </div>
</div>
