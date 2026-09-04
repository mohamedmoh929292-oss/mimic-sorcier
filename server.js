const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;

app.use(express.static(__dirname));

const rooms = new Map();

const references = [
  {
    id: "ref_001",
    title: "Référence 1",
    audio: "/ref_001.mp4",
    expectedText: ""
  },
  {
    id: "ref_002",
    title: "Référence 2",
    audio: "/ref_002.mp4",
    expectedText: ""
  },
  {
    id: "ref_003",
    title: "Référence 3",
    audio: "/ref_003.mp4",
    expectedText: ""
  },
  {
    id: "ref_004",
    title: "Référence 4",
    audio: "/ref_004.mp4",
    expectedText: ""
  },
  {
    id: "ref_005",
    title: "Référence 5",
    audio: "/ref_005.mp4",
    expectedText: ""
  },
  {
    id: "ref_006",
    title: "Référence 6",
    audio: "/ref_006.mp4",
    expectedText: ""
  },
  {
    id: "ref_007",
    title: "Référence 7",
    audio: "/ref_007.mp4",
    expectedText: ""
  },
  {
    id: "ref_008",
    title: "Référence 8",
    audio: "/ref_008.mp4",
    expectedText: ""
  },
  {
    id: "ref_009",
    title: "Référence 9",
    audio: "/ref_009.mp4",
    expectedText: ""
  }
];

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (rooms.has(code));
  return code;
}

function safeName(name) {
  return String(name || "")
    .trim()
    .replace(/[<>]/g, "")
    .slice(0, 24);
}

function roomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    phase: room.phase,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      ready: p.ready,
      score: p.score,
      connected: true
    })),
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    currentReference: room.currentReference
      ? {
          id: room.currentReference.id,
          title: room.currentReference.title,
          audio: room.currentReference.audio
        }
      : null,
    currentPlayerId: room.currentPlayerId,
    currentTurnIndex: room.currentTurnIndex,
    roundNumber: room.roundNumber,
    totalReferences: references.length
  };
}

function emitRoom(room) {
  io.to(room.code).emit("room_state", roomState(room));
}

function getRoomOf(socket) {
  const code = socket.data.roomCode;
  if (!code) return null;
  return rooms.get(code) || null;
}

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[m][n];
}

function textSimilarity(a, b) {
  a = normalizeText(a);
  b = normalizeText(b);
  if (!a || !b) return null;
  const dist = levenshtein(a, b);
  return Math.max(0, 1 - dist / Math.max(a.length, b.length, 1));
}

function evaluateImitation(transcript, expectedText, durationMs) {
  const cleanTranscript = normalizeText(transcript);
  const similarity = textSimilarity(cleanTranscript, expectedText);

  // Rien (ou presque rien) n'a été reconnu : on ne donne aucune note
  // et le joueur garde son tour pour pouvoir recommencer.
  if (!cleanTranscript || cleanTranscript.length < 2 || similarity === null) {
    return { valid: false, reason: "Imitation non reconnue — réessaie." };
  }

  // Une phrase complètement hors sujet ne doit pas recevoir une mauvaise note :
  // elle est considérée comme une tentative non reconnue et peut être rejouée.
  if (similarity < 0.18) {
    return { valid: false, reason: "Imitation trop éloignée de la référence — réessaie." };
  }

  const durationBonus = durationMs >= 500 && durationMs <= 8000 ? 8 : 0;
  const score = Math.max(0, Math.min(100, Math.round(similarity * 92 + durationBonus)));
  return { valid: true, score };
}

function chooseNextReference(room) {
  const available = references.filter(r => !room.usedReferenceIds.has(r.id));
  if (!available.length) return null;
  return available[Math.floor(Math.random() * available.length)];
}

function beginReference(room) {
  const ref = chooseNextReference(room);
  if (!ref) {
    finishGame(room);
    return;
  }

  room.usedReferenceIds.add(ref.id);
  room.currentReference = ref;
  room.currentTurnIndex = 0;
  room.currentPlayerId = room.players[0]?.id || null;
  room.phase = "reference";
  room.roundNumber += 1;

  io.to(room.code).emit("reference_started", {
    reference: {
      id: ref.id,
      title: ref.title,
      audio: ref.audio
    },
    currentPlayerId: room.currentPlayerId,
    roundNumber: room.roundNumber
  });

  emitRoom(room);
}

function advanceTurn(room) {
  if (room.players.length < MIN_PLAYERS) {
    finishGame(room, "La partie s'arrête car il ne reste qu'un joueur.");
    return;
  }

  room.currentTurnIndex += 1;

  if (room.currentTurnIndex >= room.players.length) {
    beginReference(room);
    return;
  }

  room.currentPlayerId = room.players[room.currentTurnIndex].id;
  room.phase = "turn";

  io.to(room.code).emit("next_turn", {
    currentPlayerId: room.currentPlayerId
  });

  emitRoom(room);
}

function finishGame(room, reason = "Toutes les références ont été jouées.") {
  room.phase = "finished";
  const ranking = [...room.players]
    .sort((a, b) => b.score - a.score)
    .map((p, index) => ({
      rank: index + 1,
      id: p.id,
      name: p.name,
      score: p.score
    }));

  io.to(room.code).emit("game_finished", {
    reason,
    ranking
  });

  setTimeout(() => {
    if (rooms.has(room.code)) {
      rooms.delete(room.code);
    }
  }, 30000);
}

io.on("connection", socket => {
  socket.on("create_room", ({ name }, callback) => {
    name = safeName(name);
    if (!name) return callback?.({ ok: false, error: "Pseudo invalide." });

    const code = makeRoomCode();
    const room = {
      code,
      hostId: socket.id,
      phase: "lobby",
      players: [
        {
          id: socket.id,
          name,
          ready: false,
          score: 0
        }
      ],
      usedReferenceIds: new Set(),
      currentReference: null,
      currentPlayerId: null,
      currentTurnIndex: 0,
      roundNumber: 0
    };

    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    callback?.({ ok: true, code });
    emitRoom(room);
  });

  socket.on("join_room", ({ code, name }, callback) => {
    code = String(code || "").trim().toUpperCase();
    name = safeName(name);

    const room = rooms.get(code);
    if (!room) return callback?.({ ok: false, error: "Party introuvable." });
    if (room.phase !== "lobby") return callback?.({ ok: false, error: "La partie a déjà commencé." });
    if (room.players.length >= MAX_PLAYERS) return callback?.({ ok: false, error: "La party est pleine." });
    if (!name) return callback?.({ ok: false, error: "Pseudo invalide." });

    room.players.push({
      id: socket.id,
      name,
      ready: false,
      score: 0
    });

    socket.join(code);
    socket.data.roomCode = code;

    callback?.({ ok: true, code });
    emitRoom(room);
  });

  socket.on("start_explanation", (_, callback) => {
    const room = getRoomOf(socket);
    if (!room) return callback?.({ ok: false, error: "Party introuvable." });
    if (room.hostId !== socket.id) return callback?.({ ok: false, error: "Seul l'hôte peut lancer." });
    if (room.players.length < MIN_PLAYERS) return callback?.({ ok: false, error: "Il faut au moins 2 joueurs." });

    room.phase = "rules";
    room.players.forEach(p => p.ready = false);

    io.to(room.code).emit("show_rules");
    emitRoom(room);
    callback?.({ ok: true });
  });

  socket.on("rules_ready", () => {
    const room = getRoomOf(socket);
    if (!room || room.phase !== "rules") return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;
    player.ready = true;

    emitRoom(room);

    if (room.players.length >= MIN_PLAYERS && room.players.every(p => p.ready)) {
      beginReference(room);
    }
  });

  socket.on("reference_listened", () => {
    const room = getRoomOf(socket);
    if (!room || !room.currentReference) return;

    // La référence reste réécoutable par tout le monde.
    // On passe simplement l'état en "turn" après le premier lancement.
    if (room.phase === "reference") {
      room.phase = "turn";
      emitRoom(room);
    }
  });

  socket.on("submit_imitation", ({ transcript, durationMs }, callback) => {
    const room = getRoomOf(socket);
    if (!room || !room.currentReference) {
      return callback?.({ ok: false, error: "Aucune référence active." });
    }

    if (room.currentPlayerId !== socket.id) {
      return callback?.({ ok: false, error: "Ce n'est pas ton tour." });
    }

    const player = room.players.find(p => p.id === socket.id);
    if (!player) return;

    const evaluation = evaluateImitation(
      transcript,
      room.currentReference.expectedText,
      Number(durationMs || 0)
    );

    if (!evaluation.valid) {
      return callback?.({ ok: false, error: evaluation.reason, retry: true });
    }

    const score = evaluation.score;
    player.score += score;

    io.to(room.code).emit("turn_result", {
      playerId: player.id,
      playerName: player.name,
      score,
      totalScore: player.score,
      transcript: transcript || ""
    });

    callback?.({ ok: true, score });

    setTimeout(() => {
      if (rooms.has(room.code)) advanceTurn(room);
    }, 2500);
  });

  socket.on("end_game", (_, callback) => {
    const room = getRoomOf(socket);
    if (!room) return callback?.({ ok: false, error: "Party introuvable." });
    if (room.hostId !== socket.id) return callback?.({ ok: false, error: "Seul l'hôte peut arrêter la partie." });

    finishGame(room, "L'hôte a mis fin à la partie.");
    callback?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const room = getRoomOf(socket);
    if (!room) return;

    const wasHost = room.hostId === socket.id;
    room.players = room.players.filter(p => p.id !== socket.id);

    if (!room.players.length) {
      rooms.delete(room.code);
      return;
    }

    if (wasHost) {
      room.hostId = room.players[0].id;
      io.to(room.code).emit("host_changed", { hostId: room.hostId });
    }

    if (room.phase !== "lobby" && room.players.length < MIN_PLAYERS) {
      finishGame(room, "La partie s'arrête car il ne reste qu'un joueur.");
      return;
    }

    if (room.currentPlayerId === socket.id && room.phase === "turn") {
      room.currentTurnIndex = Math.min(room.currentTurnIndex, room.players.length - 1);
      room.currentPlayerId = room.players[room.currentTurnIndex]?.id || null;
    }

    emitRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Mimic Sorcier lancé sur http://localhost:${PORT}`);
});
