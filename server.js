const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 10 * 1024 * 1024
});

const PORT = process.env.PORT || 3000;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;

// Ton dépôt Render sert actuellement les fichiers directement à la racine.
app.use(express.static(__dirname));

const rooms = new Map();

const references = [
  { id: "ref_001", title: "Référence 1", audio: "/ref_001.mp4" },
  { id: "ref_002", title: "Référence 2", audio: "/ref_002.mp4" },
  { id: "ref_003", title: "Référence 3", audio: "/ref_003.mp4" },
  { id: "ref_004", title: "Référence 4", audio: "/ref_004.mp4" },
  { id: "ref_005", title: "Référence 5", audio: "/ref_005.mp4" },
  { id: "ref_006", title: "Référence 6", audio: "/ref_006.mp4" },
  { id: "ref_007", title: "Référence 7", audio: "/ref_007.mp4" },
  { id: "ref_008", title: "Référence 8", audio: "/ref_008.mp4" },
  { id: "ref_009", title: "Référence 9", audio: "/ref_009.mp4" }
];

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = Array.from(
      { length: 6 },
      () => chars[Math.floor(Math.random() * chars.length)]
    ).join("");
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

function chooseNextReference(room) {
  const available = references.filter(
    r => !room.usedReferenceIds.has(r.id)
  );

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

  // Nouvelle manche = on efface les imitations de la manche précédente.
  room.roundImitations = [];
  room.juryIndex = 0;
  room.juryVotes = new Map();

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

  // Tout le monde a imité : on passe au jury au lieu de changer de référence.
  if (room.currentTurnIndex >= room.players.length) {
    beginJury(room);
    return;
  }

  room.currentPlayerId = room.players[room.currentTurnIndex].id;
  room.phase = "turn";

  io.to(room.code).emit("next_turn", {
    currentPlayerId: room.currentPlayerId
  });

  emitRoom(room);
}

function beginJury(room) {
  // On ne garde que les imitations des joueurs encore présents.
  room.roundImitations = room.roundImitations.filter(imitation =>
    room.players.some(p => p.id === imitation.playerId)
  );

  if (!room.roundImitations.length) {
    beginReference(room);
    return;
  }

  room.phase = "jury";
  room.currentPlayerId = null;
  room.juryIndex = 0;
  room.juryVotes = new Map();

  playCurrentJuryImitation(room);
}

function playCurrentJuryImitation(room) {
  if (!rooms.has(room.code)) return;

  if (room.players.length < MIN_PLAYERS) {
    finishGame(room, "La partie s'arrête car il ne reste qu'un joueur.");
    return;
  }

  if (room.juryIndex >= room.roundImitations.length) {
    beginReference(room);
    return;
  }

  const imitation = room.roundImitations[room.juryIndex];

  // Si le joueur a quitté, on saute son imitation.
  if (!room.players.some(p => p.id === imitation.playerId)) {
    room.juryIndex += 1;
    playCurrentJuryImitation(room);
    return;
  }

  room.juryVotes = new Map();

  io.to(room.code).emit("jury_imitation", {
    playerId: imitation.playerId,
    playerName: imitation.playerName,
    audio: imitation.audio,
    mimeType: imitation.mimeType,
    index: room.juryIndex + 1,
    total: room.roundImitations.length
  });

  emitRoom(room);
}

function finishCurrentJuryVote(room) {
  const imitation = room.roundImitations[room.juryIndex];
  if (!imitation) return;

  const scores = [...room.juryVotes.values()];
  const average = scores.length
    ? Math.round(scores.reduce((sum, n) => sum + n, 0) / scores.length)
    : 0;

  const player = room.players.find(p => p.id === imitation.playerId);
  if (player) {
    player.score += average;
  }

  io.to(room.code).emit("jury_result", {
    playerId: imitation.playerId,
    playerName: imitation.playerName,
    score: average,
    votesCount: scores.length,
    totalScore: player?.score ?? 0
  });

  emitRoom(room);

  setTimeout(() => {
    if (!rooms.has(room.code)) return;
    room.juryIndex += 1;
    playCurrentJuryImitation(room);
  }, 2500);
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

    if (!name) {
      return callback?.({ ok: false, error: "Pseudo invalide." });
    }

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
      roundNumber: 0,
      roundImitations: [],
      juryIndex: 0,
      juryVotes: new Map()
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

    if (!room) {
      return callback?.({ ok: false, error: "Party introuvable." });
    }

    if (room.phase !== "lobby") {
      return callback?.({
        ok: false,
        error: "La partie a déjà commencé."
      });
    }

    if (room.players.length >= MAX_PLAYERS) {
      return callback?.({ ok: false, error: "La party est pleine." });
    }

    if (!name) {
      return callback?.({ ok: false, error: "Pseudo invalide." });
    }

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

    if (!room) {
      return callback?.({ ok: false, error: "Party introuvable." });
    }

    if (room.hostId !== socket.id) {
      return callback?.({
        ok: false,
        error: "Seul l'hôte peut lancer."
      });
    }

    if (room.players.length < MIN_PLAYERS) {
      return callback?.({
        ok: false,
        error: "Il faut au moins 2 joueurs."
      });
    }

    room.phase = "rules";
    room.players.forEach(p => (p.ready = false));

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

    if (
      room.players.length >= MIN_PLAYERS &&
      room.players.every(p => p.ready)
    ) {
      beginReference(room);
    }
  });

  socket.on("reference_listened", () => {
    const room = getRoomOf(socket);

    if (!room || !room.currentReference) return;

    if (room.phase === "reference") {
      room.phase = "turn";
      emitRoom(room);
    }
  });

  socket.on(
    "submit_imitation",
    ({ audio, mimeType, durationMs }, callback) => {
      const room = getRoomOf(socket);

      if (!room || !room.currentReference) {
        return callback?.({
          ok: false,
          error: "Aucune référence active."
        });
      }

      if (room.currentPlayerId !== socket.id) {
        return callback?.({
          ok: false,
          error: "Ce n'est pas ton tour."
        });
      }

      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;

      if (!audio) {
        return callback?.({
          ok: false,
          error: "L'enregistrement audio est vide."
        });
      }

      const audioBuffer = Buffer.isBuffer(audio)
        ? audio
        : Buffer.from(audio);

      // Limite simple de sécurité : 10 Mo par imitation.
      if (audioBuffer.length > 10 * 1024 * 1024) {
        return callback?.({
          ok: false,
          error: "L'imitation est trop longue."
        });
      }

      room.roundImitations.push({
        playerId: player.id,
        playerName: player.name,
        audio: audioBuffer,
        mimeType: String(mimeType || "audio/webm"),
        durationMs: Number(durationMs || 0)
      });

      io.to(room.code).emit("imitation_recorded", {
        playerId: player.id,
        playerName: player.name
      });

      callback?.({ ok: true });

      setTimeout(() => {
        if (rooms.has(room.code)) {
          advanceTurn(room);
        }
      }, 900);
    }
  );

  socket.on("submit_jury_vote", ({ score }, callback) => {
    const room = getRoomOf(socket);

    if (!room || room.phase !== "jury") {
      return callback?.({
        ok: false,
        error: "Le jury n'est pas actif."
      });
    }

    const imitation = room.roundImitations[room.juryIndex];

    if (!imitation) {
      return callback?.({
        ok: false,
        error: "Aucune imitation à noter."
      });
    }

    if (socket.id === imitation.playerId) {
      return callback?.({
        ok: false,
        error: "Tu ne peux pas noter ta propre imitation."
      });
    }

    if (!room.players.some(p => p.id === socket.id)) {
      return callback?.({
        ok: false,
        error: "Joueur introuvable."
      });
    }

    if (room.juryVotes.has(socket.id)) {
      return callback?.({
        ok: false,
        error: "Tu as déjà voté."
      });
    }

    let cleanScore = Math.round(Number(score));
    cleanScore = Math.max(0, Math.min(100, cleanScore));

    if (!Number.isFinite(cleanScore)) {
      return callback?.({
        ok: false,
        error: "Note invalide."
      });
    }

    room.juryVotes.set(socket.id, cleanScore);
    callback?.({ ok: true });

    const eligibleVoters = room.players.filter(
      p => p.id !== imitation.playerId
    );

    io.to(room.code).emit("jury_vote_progress", {
      votes: room.juryVotes.size,
      needed: eligibleVoters.length
    });

    if (room.juryVotes.size >= eligibleVoters.length) {
      finishCurrentJuryVote(room);
    }
  });

  socket.on("end_game", (_, callback) => {
    const room = getRoomOf(socket);

    if (!room) {
      return callback?.({ ok: false, error: "Party introuvable." });
    }

    if (room.hostId !== socket.id) {
      return callback?.({
        ok: false,
        error: "Seul l'hôte peut arrêter la partie."
      });
    }

    finishGame(room, "L'hôte a mis fin à la partie.");
    callback?.({ ok: true });
  });

  socket.on("disconnect", () => {
    const room = getRoomOf(socket);
    if (!room) return;

    const wasHost = room.hostId === socket.id;

    room.players = room.players.filter(p => p.id !== socket.id);
    room.juryVotes?.delete(socket.id);

    if (!room.players.length) {
      rooms.delete(room.code);
      return;
    }

    if (wasHost) {
      room.hostId = room.players[0].id;
      io.to(room.code).emit("host_changed", {
        hostId: room.hostId
      });
    }

    if (room.phase !== "lobby" && room.players.length < MIN_PLAYERS) {
      finishGame(
        room,
        "La partie s'arrête car il ne reste qu'un joueur."
      );
      return;
    }

    if (
      room.currentPlayerId === socket.id &&
      ["reference", "turn"].includes(room.phase)
    ) {
      room.currentTurnIndex = Math.min(
        room.currentTurnIndex,
        room.players.length - 1
      );

      room.currentPlayerId =
        room.players[room.currentTurnIndex]?.id || null;

      emitRoom(room);
    }

    if (room.phase === "jury") {
      const imitation = room.roundImitations[room.juryIndex];

      if (imitation?.playerId === socket.id) {
        room.roundImitations.splice(room.juryIndex, 1);
        playCurrentJuryImitation(room);
        return;
      }

      const eligibleVoters = room.players.filter(
        p => p.id !== imitation?.playerId
      );

      if (
        imitation &&
        room.juryVotes.size >= eligibleVoters.length
      ) {
        finishCurrentJuryVote(room);
        return;
      }
    }

    emitRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`Mimic Sorcier lancé sur http://localhost:${PORT}`);
});
