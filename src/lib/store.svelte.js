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
const CONNECT_TIMEOUT = 12000;

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function applyState(raw) {
  if (!raw) return;
  game.players = raw.players || [];
  game.phase = raw.phase || 'voting';
  game.revealedCards = raw.revealedCards || {};
  game.connected = true;
  game.connecting = false;
  game.error = '';
  const hostId = raw.hostId || game.players[0]?.id || '';
  game.isHost = hostId === game.myId;
  if (game.phase === 'voting') {
    game.selectedCard = null;
  }
}

function buildState() {
  return {
    players: game.players,
    phase: game.phase,
    revealedCards: game.revealedCards,
    hostId: game.players[0]?.id || game.myId,
  };
}

async function subscribeRoom(code) {
  if (channel) await supabase.removeChannel(channel);
  channel = supabase.channel(`room-${code}`);
  channel.on('postgres_changes',
    { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${code}` },
    (payload) => { applyState(payload.new?.state); }
  ).subscribe();
}

async function readStateFromDb() {
  const { data } = await supabase
    .from('rooms')
    .select('state')
    .eq('code', game.roomId)
    .single();
  return data?.state;
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
    const state = buildState();
    await supabase.from('rooms').upsert(
      { code: game.roomId, state },
      { onConflict: 'code' }
    );
    applyState(state);
    clearTimeout(connectTimer);
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
    const dbState = await readStateFromDb();
    if (!dbState) {
      game.error = 'Raum nicht gefunden. Code prüfen.';
      game.connecting = false;
      clearTimeout(connectTimer);
      return;
    }
    dbState.players = [...(dbState.players || []), { id: game.myId, name, hasVoted: false, cardValue: null }];
    await supabase.from('rooms').update({ state: dbState }).eq('code', game.roomId);
    applyState(dbState);
    clearTimeout(connectTimer);
  } catch (err) {
    clearTimeout(connectTimer);
    game.error = `Fehler: ${err.message}`;
    game.connecting = false;
  }
}

export async function selectCard(value) {
  game.selectedCard = value;
  const dbState = await readStateFromDb();
  if (!dbState) return;
  dbState.players = dbState.players.map(p =>
    p.id === game.myId ? { ...p, cardValue: value, hasVoted: true } : p
  );
  game.players = dbState.players;
  await supabase.from('rooms').update({ state: dbState }).eq('code', game.roomId);
}

export async function revealCards() {
  if (!game.isHost) return;
  const dbState = await readStateFromDb();
  if (!dbState) return;
  dbState.phase = 'revealed';
  dbState.revealedCards = Object.fromEntries(
    dbState.players.map(p => [p.id, p.cardValue])
  );
  await supabase.from('rooms').update({ state: dbState }).eq('code', game.roomId);
  applyState(dbState);
}

export async function newRound() {
  if (!game.isHost) return;
  const dbState = await readStateFromDb();
  if (!dbState) return;
  dbState.phase = 'voting';
  dbState.players = dbState.players.map(p => ({ ...p, cardValue: null, hasVoted: false }));
  dbState.revealedCards = {};
  await supabase.from('rooms').update({ state: dbState }).eq('code', game.roomId);
  applyState(dbState);
}

export async function leaveRoom() {
  if (game.roomId && game.myId && game.players.length > 0) {
    try {
      const dbState = await readStateFromDb();
      if (dbState) {
        dbState.players = dbState.players.filter(p => p.id !== game.myId);
        if (dbState.players.length > 0) {
          await supabase.from('rooms').update({ state: dbState }).eq('code', game.roomId);
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
