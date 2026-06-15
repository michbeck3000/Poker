import { supabase } from './supabase.js';

export const CARD_VALUES = [1, 2, 3, 5, 8, 13, 20, 40, 100, '?', '☕'];

export const game = $state({
  myName: '',
  myId: '',
  roomId: '',
  isHost: false,
  selectedCard: null,
  phase: 'voting',
  connected: false,
  connecting: false,
  players: [],
  error: '',
  revealedCards: {},
});

let channel = null;
let connectTimer = null;
let pollTimer = null;
const CONNECT_TIMEOUT = 12000;
const POLL_INTERVAL = 1500;

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function applyState(raw) {
  if (!raw) return;
  const wasRevealed = game.phase === 'revealed';
  game.players = raw.players || [];
  game.phase = raw.phase || 'voting';
  game.revealedCards = raw.revealedCards || {};
  game.connected = true;
  game.connecting = false;
  game.error = '';
  const hostId = raw.hostId || game.players[0]?.id || '';
  game.isHost = hostId === game.myId;
  if (game.phase === 'voting' && wasRevealed) {
    game.selectedCard = null;
  }
}

async function pollState() {
  if (!game.roomId) return;
  try {
    const { data } = await supabase
      .from('rooms')
      .select('state')
      .eq('code', game.roomId)
      .single();
    if (data?.state) applyState(data.state);
  } catch (_) {}
}

async function subscribeRoom(code) {
  if (channel) await supabase.removeChannel(channel);
  channel = supabase.channel(`room-${code}`);
  channel.on('postgres_changes',
    { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${code}` },
    (payload) => { applyState(payload.new?.state); }
  ).subscribe();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollState, POLL_INTERVAL);
}

async function readState() {
  const { data, error } = await supabase
    .from('rooms')
    .select('state')
    .eq('code', game.roomId)
    .single();
  if (error) throw error;
  return data?.state;
}

async function writeState() {
  const state = {
    players: game.players,
    phase: game.phase,
    revealedCards: game.revealedCards,
    hostId: game.players[0]?.id || game.myId,
  };
  await supabase.from('rooms').upsert(
    { code: game.roomId, state },
    { onConflict: 'code' }
  );
}

export async function createRoom(name) {
  cleanup();
  game.myName = name;
  game.myId = generateId();
  game.isHost = true;
  game.connecting = true;
  game.error = '';
  const code = generateRoomCode();
  game.roomId = code;
  connectTimer = setTimeout(() => {
    if (!game.connected) {
      game.error = 'Verbindung fehlgeschlagen. Prüfe Firewall/Netzwerk.';
      cleanup();
    }
  }, CONNECT_TIMEOUT);
  try {
    await subscribeRoom(code);
    game.players = [{ id: game.myId, name, hasVoted: false, cardValue: null }];
    game.phase = 'voting';
    game.revealedCards = {};
    await writeState();
    clearTimeout(connectTimer);
    applyState({
      players: game.players,
      phase: 'voting',
      revealedCards: {},
      hostId: game.myId,
    });
  } catch (err) {
    clearTimeout(connectTimer);
    game.error = `Fehler: ${err.message}`;
    game.connecting = false;
  }
}

export async function joinRoom(name, code) {
  cleanup();
  game.myName = name;
  game.myId = generateId();
  game.isHost = false;
  game.connecting = true;
  game.error = '';
  game.roomId = code;
  connectTimer = setTimeout(() => {
    if (!game.connected) {
      game.error = 'Verbindung fehlgeschlagen. Prüfe Firewall/Netzwerk.';
      cleanup();
    }
  }, CONNECT_TIMEOUT);
  try {
    await subscribeRoom(code);
    const state = await readState();
    if (!state) {
      game.error = 'Raum nicht gefunden. Code prüfen.';
      game.connecting = false;
      clearTimeout(connectTimer);
      return;
    }
    const newPlayer = { id: game.myId, name, hasVoted: false, cardValue: null };
    state.players = [...(state.players || []), newPlayer];
    await supabase.from('rooms').update({ state }).eq('code', code);
    applyState(state);
    clearTimeout(connectTimer);
  } catch (err) {
    clearTimeout(connectTimer);
    game.error = `Fehler: ${err.message}`;
    game.connecting = false;
  }
}

export async function selectCard(value) {
  game.selectedCard = value;
  game.players = game.players.map(p =>
    p.id === game.myId ? { ...p, cardValue: value, hasVoted: true } : p
  );
  const state = await readState();
  if (!state) return;
  state.players = state.players.map(p =>
    p.id === game.myId ? { ...p, cardValue: value, hasVoted: true } : p
  );
  await supabase.from('rooms').update({ state }).eq('code', game.roomId);
}

export async function revealCards() {
  if (!game.isHost) return;
  const state = await readState();
  if (!state) return;
  state.phase = 'revealed';
  state.revealedCards = Object.fromEntries(
    state.players.map(p => [p.id, p.cardValue])
  );
  await supabase.from('rooms').update({ state }).eq('code', game.roomId);
  applyState(state);
}

export async function newRound() {
  if (!game.isHost) return;
  const state = await readState();
  if (!state) return;
  state.phase = 'voting';
  state.players = state.players.map(p => ({ ...p, cardValue: null, hasVoted: false }));
  state.revealedCards = {};
  await supabase.from('rooms').update({ state }).eq('code', game.roomId);
  applyState(state);
}

export async function leaveRoom() {
  if (game.roomId && game.myId) {
    try {
      const state = await readState();
      if (state) {
        state.players = state.players.filter(p => p.id !== game.myId);
        if (state.players.length > 0) {
          await supabase.from('rooms').update({ state }).eq('code', game.roomId);
        } else {
          await supabase.from('rooms').delete().eq('code', game.roomId);
        }
      }
    } catch (_) {}
  }
  cleanup();
}

async function cleanup() {
  clearTimeout(connectTimer);
  if (pollTimer) clearInterval(pollTimer);
  if (channel) {
    await supabase.removeChannel(channel);
    channel = null;
  }
  game.myId = '';
  game.selectedCard = null;
  game.phase = 'voting';
  game.connected = false;
  game.connecting = false;
  game.players = [];
  game.error = '';
  game.isHost = false;
  game.roomId = '';
  game.revealedCards = {};
}
