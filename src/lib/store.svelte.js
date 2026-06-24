import { supabase } from './supabase.js';

export const CARD_VALUES = [1, 2, 3, 5, 8, 13, 20, 40, 100, '?', '☕'];

export const game = $state({
  myName: localStorage.getItem('scrumPokerName') || '',
  myId: localStorage.getItem('scrumPokerId') || '',
  roomId: '',
  myCardValue: null,
  selectedCard: null,
  phase: 'voting',
  connected: false,
  connecting: false,
  players: [],
  error: '',
  revealedCards: {},
  throws: [],
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
  game.throws = (raw.throws || []).filter(t => Date.now() - t.timestamp < 5000);
  game.connected = true;
  game.connecting = false;
  game.error = '';
  if (game.phase === 'voting' && wasRevealed) {
    game.selectedCard = null;
    game.myCardValue = null;
  }
  if (game.phase === 'revealed' && game.myId && game.myCardValue != null && !game.revealedCards[game.myId]) {
    submitMyCardValue();
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
  const { data } = await supabase
    .from('rooms')
    .select('state')
    .eq('code', game.roomId)
    .limit(1);
  return data?.[0]?.state ?? null;
}

async function writeState() {
  const state = {
    players: game.players,
    phase: game.phase,
    revealedCards: game.revealedCards,
    throws: game.throws,
  };
  await supabase.from('rooms').upsert(
    { code: game.roomId, state },
    { onConflict: 'code' }
  );
}

function persistSession() {
  localStorage.setItem('scrumPokerId', game.myId);
  localStorage.setItem('scrumPokerName', game.myName);
  if (game.roomId) localStorage.setItem('scrumPokerRoom', game.roomId);
}

export async function createRoom(name) {
  cleanup();
  game.myName = name;
  game.myId = game.myId || generateId();
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
    game.players = [{ id: game.myId, name, hasVoted: false }];
    game.phase = 'voting';
    game.revealedCards = {};
    await writeState();
    clearTimeout(connectTimer);
    persistSession();
    applyState({
      players: game.players,
      phase: 'voting',
      revealedCards: {},
    });
  } catch (err) {
    clearTimeout(connectTimer);
    game.error = `Fehler: ${err.message}`;
    game.connecting = false;
  }
}

export async function joinRoom(name, code, existingId) {
  cleanup();
  game.myName = name;
  game.myId = existingId || game.myId || generateId();
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
    const existing = state.players.find(p => p.id === game.myId);
    if (existing) {
      existing.name = name;
      existing.hasVoted = false;
    } else {
      state.players.push({ id: game.myId, name, hasVoted: false });
    }
    await supabase.from('rooms').update({ state }).eq('code', code);
    persistSession();
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
  game.myCardValue = value;
  game.players = game.players.map(p =>
    p.id === game.myId ? { ...p, hasVoted: true } : p
  );
  const state = await readState();
  if (!state) return;
  state.players = state.players.map(p =>
    p.id === game.myId ? { ...p, hasVoted: true } : p
  );
  await supabase.from('rooms').update({ state }).eq('code', game.roomId);
}

export async function revealCards() {
  const state = await readState();
  if (!state) return;
  state.phase = 'revealed';
  state.revealedCards = state.revealedCards || {};
  state.revealedCards[game.myId] = game.myCardValue;
  await supabase.from('rooms').update({ state }).eq('code', game.roomId);
  applyState(state);
}

async function submitMyCardValue() {
  const state = await readState();
  if (!state || state.revealedCards?.[game.myId]) return;
  state.revealedCards = state.revealedCards || {};
  state.revealedCards[game.myId] = game.myCardValue;
  await supabase.from('rooms').update({ state }).eq('code', game.roomId);
  setTimeout(async () => {
    const check = await readState();
    if (check && !check.revealedCards?.[game.myId]) {
      submitMyCardValue();
    }
  }, 1500);
}

export async function newRound() {
  const state = await readState();
  if (!state) return;
  state.phase = 'voting';
  state.players = state.players.map(p => ({ ...p, hasVoted: false }));
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
  localStorage.removeItem('scrumPokerRoom');
  cleanup();
}

export async function throwEmoji(emoji, targetPlayerId) {
  const state = await readState();
  if (!state) return;
  const t = {
    id: 't' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
    emoji,
    sourcePlayerId: game.myId,
    targetPlayerId,
    timestamp: Date.now(),
  };
  state.throws = [...(state.throws || []), t];
  state.throws = state.throws.filter(x => Date.now() - x.timestamp < 5000);
  await supabase.from('rooms').update({ state }).eq('code', game.roomId);
  applyState(state);
}

async function cleanup() {
  clearTimeout(connectTimer);
  if (pollTimer) clearInterval(pollTimer);
  if (channel) {
    await supabase.removeChannel(channel);
    channel = null;
  }
  game.roomId = '';
  game.selectedCard = null;
  game.myCardValue = null;
  game.phase = 'voting';
  game.connected = false;
  game.connecting = false;
  game.players = [];
  game.error = '';
  game.revealedCards = {};
  game.throws = [];
}
