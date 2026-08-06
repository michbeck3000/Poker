import { supabase } from './supabase.js';

export const CARD_VALUES = [1, 2, 3, 5, 8, 13, 20, 40, 100, '?', '☕'];

export const game = $state({
  myName: '',
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
let heartbeatTimer = null;
let visibilityHandler = null;
let revealRetries = 0;
let revealInFlight = false;

const CONNECT_TIMEOUT = 12000;
const POLL_INTERVAL = 1500;
const HEARTBEAT_INTERVAL = 15000;
const STALE_THRESHOLD = 120;
const REVEAL_RETRY_MAX = 3;

function generateId() {
  return Math.random().toString(36).substring(2, 10);
}

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function jsonEncode(v) {
  if (v === null || v === undefined) return 'null';
  return JSON.stringify(v);
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
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
    revealRetries = 0;
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
      .limit(1);
    if (data?.[0]?.state) applyState(data[0].state);
  } catch (e) {
    console.warn('📡 Poll fehlgeschlagen – Netzwerk/Timeout:', e.message);
  }
}

function startHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(async () => {
    if (!game.roomId) return;
    try {
      await supabase.rpc('touch_player', { room_code: game.roomId, player_id: game.myId });
    } catch (e) {}
    try {
      await supabase.rpc('reap_disconnected', { room_code: game.roomId, threshold_sec: STALE_THRESHOLD });
    } catch (e) {}
  }, HEARTBEAT_INTERVAL);
}

async function subscribeRoom(code) {
  if (channel) await supabase.removeChannel(channel);
  channel = supabase.channel(`room-${code}`);
  channel.on('postgres_changes',
    { event: '*', schema: 'public', table: 'rooms', filter: `code=eq.${code}` },
    (payload) => { applyState(payload.new?.state); }
  ).subscribe((status, err) => {
    if (status === 'CHANNEL_ERROR') {
      console.warn('📡 Realtime nicht verfügbar – nur Polling aktiv:', err?.message);
      if (channel) { supabase.removeChannel(channel); channel = null; }
    } else if (status === 'TIMED_OUT') {
      console.warn('📡 Realtime-Timeout – nur Polling aktiv');
      if (channel) { supabase.removeChannel(channel); channel = null; }
    } else if (status === 'SUBSCRIBED') {
      console.log('📡 Realtime verbunden');
    }
  });
  function handleVisibility() {
    if (document.visibilityState === 'visible') {
      pollState();
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(pollState, POLL_INTERVAL);
    } else {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }
  }
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
  visibilityHandler = handleVisibility;
  document.addEventListener('visibilitychange', handleVisibility);
  handleVisibility();
}

async function readState() {
  const { data } = await supabase
    .from('rooms')
    .select('state')
    .eq('code', game.roomId)
    .limit(1);
  return data?.[0]?.state ?? null;
}

function persistSession() {
  localStorage.setItem('scrumPokerId', game.myId);
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
    const initial = {
      players: [{ id: game.myId, name, hasVoted: false, lastSeen: nowSec() }],
      phase: 'voting',
      revealedCards: {},
      throws: [],
    };
    await supabase.from('rooms').upsert(
      { code, state: initial },
      { onConflict: 'code' }
    );
    clearTimeout(connectTimer);
    persistSession();
    startHeartbeat();
    applyState(initial);
  } catch (err) {
    clearTimeout(connectTimer);
    console.warn('🆕 Raum erstellen fehlgeschlagen:', err.message);
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
    const exists = await readState();
    if (!exists) {
      game.error = 'Raum nicht gefunden. Code prüfen.';
      game.connecting = false;
      clearTimeout(connectTimer);
      return;
    }
    await supabase.rpc('join_room', { room_code: code, player_id: game.myId, player_name: name });
    persistSession();
    startHeartbeat();
    const fresh = await readState();
    if (!fresh) {
      game.error = 'Raum nicht gefunden. Code prüfen.';
      game.connecting = false;
      clearTimeout(connectTimer);
      return;
    }
    applyState(fresh);
    clearTimeout(connectTimer);
  } catch (err) {
    clearTimeout(connectTimer);
    console.warn('🚪 Raum beitreten fehlgeschlagen:', err.message);
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
  try {
    await supabase.rpc('set_player_voted', { room_code: game.roomId, player_id: game.myId });
  } catch (e) {
    console.warn('🃏 Kartenauswahl fehlgeschlagen:', e.message);
  }
}

export async function revealCards() {
  try {
    await supabase.rpc('reveal_card', {
      room_code: game.roomId,
      player_id: game.myId,
      value: jsonEncode(game.myCardValue),
    });
  } catch (e) {
    console.warn('🔓 Aufdecken fehlgeschlagen:', e.message);
  }
}

async function submitMyCardValue() {
  if (revealInFlight || revealRetries >= REVEAL_RETRY_MAX) return;
  revealInFlight = true;
  try {
    await supabase.rpc('reveal_card', {
      room_code: game.roomId,
      player_id: game.myId,
      value: jsonEncode(game.myCardValue),
    });
  } catch (e) {
    revealRetries++;
    console.warn('🔄 Eigener Wert nicht übermittelt – neuer Versuch:', e.message);
  } finally {
    revealInFlight = false;
  }
  setTimeout(async () => {
    const check = await readState();
    if (check && !check.revealedCards?.[game.myId] && revealRetries < REVEAL_RETRY_MAX) {
      revealRetries++;
      submitMyCardValue();
    }
  }, 1500);
}

export async function newRound() {
  try {
    await supabase.rpc('new_round', { room_code: game.roomId });
    revealRetries = 0;
  } catch (e) {
    console.warn('🆕 Neue Runde fehlgeschlagen:', e.message);
  }
}

export async function leaveRoom() {
  if (game.roomId && game.myId) {
    try {
      await supabase.rpc('remove_player', { room_code: game.roomId, player_id: game.myId });
    } catch (e) {
      console.warn('👋 Verlassen fehlgeschlagen:', e.message);
    }
  }
  localStorage.removeItem('scrumPokerRoom');
  cleanup();
}

export async function throwEmoji(emoji, targetPlayerId) {
  try {
    const t = {
      id: 't' + Date.now().toString(36) + Math.random().toString(36).substring(2, 5),
      emoji,
      sourcePlayerId: game.myId,
      targetPlayerId,
      timestamp: Date.now(),
    };
    await supabase.rpc('send_throw', { room_code: game.roomId, throw_data: t });
  } catch (e) {
    console.warn('💩 Emoji-Wurf fehlgeschlagen:', e.message);
  }
}

function cleanup() {
  clearTimeout(connectTimer);
  if (pollTimer) clearInterval(pollTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (visibilityHandler) { document.removeEventListener('visibilitychange', visibilityHandler); visibilityHandler = null; }
  if (channel) {
    supabase.removeChannel(channel);
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
  revealRetries = 0;
  revealInFlight = false;
}