import Peer from 'peerjs';

const ICE_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
  ]
};

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

let peer = null;
let hostConn = null;
let connections = [];
let connectTimer = null;

const CONNECT_TIMEOUT = 12000;

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function broadcastState() {
  const msg = {
    type: 'state',
    players: game.players.map(p => ({ id: p.id, name: p.name, hasVoted: p.hasVoted })),
    phase: game.phase,
    revealedCards: {},
  };
  if (game.phase === 'revealed') {
    msg.revealedCards = Object.fromEntries(
      game.players.map(p => [p.id, p.cardValue])
    );
  }
  connections.forEach(c => { if (c.open) c.send(msg); });
}

export function createRoom(name) {
  cleanup();
  game.myName = name;
  game.isHost = true;
  game.connecting = true;
  game.error = '';
  const code = generateRoomCode();
  game.roomId = code;
  const peerId = `sp-${code}`;
  peer = new Peer(peerId, { config: ICE_CONFIG });
  connectTimer = setTimeout(() => {
    if (!game.connected) {
      game.error = 'Verbindung zum Signaling-Server fehlgeschlagen. Prüfe Firewall/Netzwerk.';
      game.connecting = false;
      cleanup();
    }
  }, CONNECT_TIMEOUT);
  peer.on('open', () => {
    clearTimeout(connectTimer);
    game.myId = peer.id;
    game.players = [{ id: peer.id, name, hasVoted: false, cardValue: null }];
    game.phase = 'voting';
    game.connected = true;
    game.connecting = false;
    game.error = '';
  });
  peer.on('connection', conn => {
    connections.push(conn);
    conn.on('data', data => {
      if (data.type === 'join') {
        game.players = [...game.players, {
          id: conn.peer, name: data.name, hasVoted: false, cardValue: null
        }];
        broadcastState();
      } else if (data.type === 'vote') {
        game.players = game.players.map(p =>
          p.id === conn.peer
            ? { ...p, cardValue: data.value, hasVoted: true }
            : p
        );
        broadcastState();
      }
    });
    conn.on('close', () => {
      connections = connections.filter(c => c !== conn);
      game.players = game.players.filter(p => p.id !== conn.peer);
      broadcastState();
    });
  });
  peer.on('error', err => {
    if (err.type === 'unavailable-id') {
      game.error = 'Room name already taken. Try again.';
    } else {
      game.error = err.message;
    }
    game.connecting = false;
  });
}

export function joinRoom(name, code) {
  cleanup();
  game.myName = name;
  game.isHost = false;
  game.connecting = true;
  game.error = '';
  game.roomId = code;
  peer = new Peer({ config: ICE_CONFIG });
  const hostId = `sp-${code}`;
  connectTimer = setTimeout(() => {
    if (!game.connected) {
      game.error = 'Verbindung zum Signaling-Server fehlgeschlagen. Prüfe Firewall/Netzwerk.';
      game.connecting = false;
      cleanup();
    }
  }, CONNECT_TIMEOUT);
  peer.on('open', () => {
    clearTimeout(connectTimer);
    game.myId = peer.id;
    hostConn = peer.connect(hostId);
    hostConn.on('open', () => hostConn.send({ type: 'join', name }));
    hostConn.on('data', data => {
      if (data.type === 'state') {
        const wasRevealed = game.phase === 'revealed';
        game.players = data.players;
        game.phase = data.phase;
        game.revealedCards = data.revealedCards || {};
        game.connected = true;
        game.connecting = false;
        game.error = '';
        if (data.phase === 'voting' && wasRevealed) {
          game.selectedCard = null;
        }
      }
    });
    hostConn.on('close', () => {
      game.error = 'Verbindung zum Host getrennt.';
      game.connected = false;
    });
  });
  peer.on('error', err => {
    game.error = `Verbindungsfehler: ${err.message}`;
    game.connecting = false;
  });
}

export function selectCard(value) {
  game.selectedCard = value;
  if (game.isHost) {
    game.players = game.players.map(p =>
      p.id === peer.id
        ? { ...p, cardValue: value, hasVoted: true }
        : p
    );
    broadcastState();
  } else if (hostConn?.open) {
    hostConn.send({ type: 'vote', value });
  }
}

export function revealCards() {
  if (!game.isHost) return;
  game.phase = 'revealed';
  game.revealedCards = Object.fromEntries(
    game.players.map(p => [p.id, p.cardValue])
  );
  broadcastState();
}

export function newRound() {
  if (!game.isHost) return;
  game.selectedCard = null;
  game.phase = 'voting';
  game.players = game.players.map(p => ({ ...p, cardValue: null, hasVoted: false }));
  game.revealedCards = {};
  broadcastState();
}

export function leaveRoom() {
  cleanup();
}

function cleanup() {
  clearTimeout(connectTimer);
  if (hostConn) { hostConn.close(); hostConn = null; }
  connections.forEach(c => c.close());
  connections = [];
  if (peer) { peer.destroy(); peer = null; }
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
