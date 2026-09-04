const socket = io();

const screens = [...document.querySelectorAll(".screen")];

const homeScreen = document.getElementById("homeScreen");
const nameScreen = document.getElementById("nameScreen");
const lobbyScreen = document.getElementById("lobbyScreen");
const rulesScreen = document.getElementById("rulesScreen");
const gameScreen = document.getElementById("gameScreen");
const finishedScreen = document.getElementById("finishedScreen");

const createPartyBtn = document.getElementById("createPartyBtn");
const joinFromHomeBtn = document.getElementById("joinFromHomeBtn");
const homeCodeInput = document.getElementById("homeCodeInput");

const nameTitle = document.getElementById("nameTitle");
const nameInput = document.getElementById("nameInput");
const confirmNameBtn = document.getElementById("confirmNameBtn");
const backHomeBtn = document.getElementById("backHomeBtn");

const roomCodeText = document.getElementById("roomCodeText");
const gameRoomCode = document.getElementById("gameRoomCode");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const playersList = document.getElementById("playersList");
const playerCount = document.getElementById("playerCount");
const startPartyBtn = document.getElementById("startPartyBtn");
const hostLobbyControls = document.getElementById("hostLobbyControls");
const waitingHostText = document.getElementById("waitingHostText");

const understoodBtn = document.getElementById("understoodBtn");
const readyStatus = document.getElementById("readyStatus");

const endGameBtn = document.getElementById("endGameBtn");
const referenceTitle = document.getElementById("referenceTitle");
const referenceAudio = document.getElementById("referenceAudio");
const playAudioBtn = document.getElementById("playAudioBtn");
const turnText = document.getElementById("turnText");
const countdown = document.getElementById("countdown");
const micBtn = document.getElementById("micBtn");
const recordingText = document.getElementById("recordingText");
const resultBox = document.getElementById("resultBox");
const resultPlayer = document.getElementById("resultPlayer");
const resultScore = document.getElementById("resultScore");
const scoreList = document.getElementById("scoreList");

const finishReason = document.getElementById("finishReason");
const finalRanking = document.getElementById("finalRanking");
const returnHomeBtn = document.getElementById("returnHomeBtn");

const toast = document.getElementById("toast");

let mode = "create";
let desiredRoomCode = "";
let state = null;
let mediaRecorder = null;
let mediaStream = null;
let recordingStartedAt = 0;
let recognition = null;
let lastTranscript = "";
let hasListenedCurrentReference = false;
let recordingLocked = false;

function showScreen(screen) {
  screens.forEach(s => s.classList.remove("active"));
  screen.classList.add("active");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  setTimeout(() => toast.classList.add("hidden"), 2600);
}

function openNameScreen(newMode, code = "") {
  mode = newMode;
  desiredRoomCode = code.toUpperCase();
  nameTitle.textContent = mode === "create" ? "Choisis ton pseudo" : `Rejoindre ${desiredRoomCode}`;
  nameInput.value = "";
  showScreen(nameScreen);
  setTimeout(() => nameInput.focus(), 50);
}

createPartyBtn.addEventListener("click", () => openNameScreen("create"));

joinFromHomeBtn.addEventListener("click", () => {
  const code = homeCodeInput.value.trim().toUpperCase();
  if (code.length !== 6) return showToast("Entre un code de party valide.");
  openNameScreen("join", code);
});

backHomeBtn.addEventListener("click", () => {
  history.replaceState({}, "", "/");
  showScreen(homeScreen);
});

confirmNameBtn.addEventListener("click", submitName);
nameInput.addEventListener("keydown", e => {
  if (e.key === "Enter") submitName();
});

function submitName() {
  const name = nameInput.value.trim();
  if (!name) return showToast("Entre un pseudo.");

  if (mode === "create") {
    socket.emit("create_room", { name }, response => {
      if (!response.ok) return showToast(response.error);
      desiredRoomCode = response.code;
      history.replaceState({}, "", `/?room=${response.code}`);
    });
  } else {
    socket.emit("join_room", { code: desiredRoomCode, name }, response => {
      if (!response.ok) return showToast(response.error);
      history.replaceState({}, "", `/?room=${response.code}`);
    });
  }
}

copyLinkBtn.addEventListener("click", async () => {
  if (!state) return;
  const link = `${location.origin}/?room=${state.code}`;

  try {
    await navigator.clipboard.writeText(link);
    showToast("Lien copié !");
  } catch {
    prompt("Copie ce lien :", link);
  }
});

startPartyBtn.addEventListener("click", () => {
  socket.emit("start_explanation", {}, response => {
    if (!response.ok) showToast(response.error);
  });
});

understoodBtn.addEventListener("click", () => {
  understoodBtn.disabled = true;
  understoodBtn.textContent = "Compris ✓";
  socket.emit("rules_ready");
});

endGameBtn.addEventListener("click", () => {
  if (!confirm("Mettre fin à la partie pour tout le monde ?")) return;

  socket.emit("end_game", {}, response => {
    if (!response.ok) showToast(response.error);
  });
});

playAudioBtn.addEventListener("click", playReference);

async function playReference() {
  try {
    referenceAudio.currentTime = 0;
    await referenceAudio.play();
    hasListenedCurrentReference = true;
    socket.emit("reference_listened");
  } catch {
    showToast("Impossible de lire l'audio.");
  }
}

micBtn.addEventListener("click", async () => {
  if (!state || state.currentPlayerId !== socket.id || recordingLocked) return;
  recordingLocked = true;
  micBtn.classList.add("hidden");

  for (let i = 5; i >= 1; i--) {
    countdown.textContent = i;
    countdown.classList.remove("hidden");
    await wait(1000);
  }
  countdown.classList.add("hidden");

  await startRecording();
});

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const r = new SpeechRecognition();
  r.lang = "fr-FR";
  r.interimResults = false;
  r.continuous = false;

  r.onresult = event => {
    lastTranscript = Array.from(event.results)
      .map(result => result[0].transcript)
      .join(" ");
  };

  return r;
}

async function startRecording() {
  lastTranscript = "";
  recognition = buildSpeechRecognition();

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    recordingLocked = false;
    micBtn.classList.remove("hidden");
    showToast("Autorise le micro pour jouer.");
    return;
  }

  const chunks = [];
  mediaRecorder = new MediaRecorder(mediaStream);

  mediaRecorder.ondataavailable = e => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const durationMs = Date.now() - recordingStartedAt;
    mediaStream?.getTracks().forEach(track => track.stop());
    recordingText.classList.add("hidden");

    socket.emit("submit_imitation", {
      transcript: lastTranscript,
      durationMs
    }, response => {
      if (!response.ok) {
        recordingLocked = false;
        showToast(response.error);
      }
    });
  };

  try { recognition?.start(); } catch {}

  mediaRecorder.start();
  recordingStartedAt = Date.now();
  recordingText.classList.remove("hidden");
  recordingText.textContent = "🎙️ Enregistrement... clique à nouveau pour terminer";

  micBtn.classList.remove("hidden");
  micBtn.textContent = "⏹️";
  micBtn.onclick = stopRecording;
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state !== "recording") return;

  try { recognition?.stop(); } catch {}
  mediaRecorder.stop();

  micBtn.onclick = null;
  micBtn.textContent = "🎙️";
  micBtn.classList.add("hidden");
}

socket.on("room_state", newState => {
  state = newState;

  roomCodeText.textContent = state.code;
  gameRoomCode.textContent = state.code;

  renderPlayers();
  renderScores();
  renderHostControls();
  renderTurn();

  if (state.phase === "lobby") showScreen(lobbyScreen);
  if (state.phase === "rules") showScreen(rulesScreen);
  if (["reference", "turn"].includes(state.phase)) showScreen(gameScreen);
});

socket.on("show_rules", () => {
  understoodBtn.disabled = false;
  understoodBtn.textContent = "J'ai compris";
  showScreen(rulesScreen);
});

socket.on("reference_started", ({ reference }) => {
  hasListenedCurrentReference = false;
  recordingLocked = false;
  resultBox.classList.add("hidden");

  referenceTitle.textContent = reference.title;
  referenceAudio.src = reference.audio;

  micBtn.textContent = "🎙️";
  micBtn.onclick = null;
  micBtn.addEventListener("click", defaultMicClick, { once: true });

  showScreen(gameScreen);
  renderTurn();
});

function defaultMicClick() {
  if (!state || state.currentPlayerId !== socket.id || recordingLocked) return;
  micBtn.click();
}

socket.on("next_turn", () => {
  recordingLocked = false;
  resultBox.classList.add("hidden");
  renderTurn();
});

socket.on("turn_result", result => {
  resultPlayer.textContent = `${result.playerName} obtient`;
  resultScore.textContent = `${result.score}/100`;
  resultBox.classList.remove("hidden");
});

socket.on("host_changed", () => {
  showToast("L'hôte a quitté. Un nouvel hôte a été choisi.");
});

socket.on("game_finished", ({ reason, ranking }) => {
  finishReason.textContent = reason;
  finalRanking.innerHTML = ranking.map(p => `
    <div class="rank-row">
      <strong>#${p.rank} ${escapeHtml(p.name)}</strong>
      <span>${p.score} pts</span>
    </div>
  `).join("");

  showScreen(finishedScreen);
});

returnHomeBtn.addEventListener("click", () => {
  location.href = "/";
});

function renderPlayers() {
  if (!state) return;

  playerCount.textContent = `${state.players.length} / ${state.maxPlayers} joueurs`;

  playersList.innerHTML = state.players.map(p => `
    <div class="player">
      <span>
        ${escapeHtml(p.name)}
        ${p.id === state.hostId ? '<span class="host-badge">HÔTE</span>' : ""}
      </span>
      <span>${p.ready ? "✓" : ""}</span>
    </div>
  `).join("");

  const ready = state.players.filter(p => p.ready).length;
  readyStatus.textContent = `${ready}/${state.players.length} joueurs ont compris.`;
}

function renderScores() {
  if (!state) return;

  const sorted = [...state.players].sort((a, b) => b.score - a.score);

  scoreList.innerHTML = sorted.map((p, index) => `
    <div class="score-row">
      <span>#${index + 1} ${escapeHtml(p.name)}</span>
      <strong>${p.score}</strong>
    </div>
  `).join("");
}

function renderHostControls() {
  if (!state) return;

  const isHost = state.hostId === socket.id;

  hostLobbyControls.classList.toggle("hidden", !isHost);
  waitingHostText.classList.toggle("hidden", isHost);
  endGameBtn.classList.toggle("hidden", !isHost);

  startPartyBtn.disabled = state.players.length < state.minPlayers;
}

function renderTurn() {
  if (!state) return;

  const current = state.players.find(p => p.id === state.currentPlayerId);
  const isMyTurn = state.currentPlayerId === socket.id;

  if (state.currentReference) {
    referenceTitle.textContent = state.currentReference.title;
    if (referenceAudio.src !== location.origin + state.currentReference.audio) {
      referenceAudio.src = state.currentReference.audio;
    }
  }

  if (!current) {
    turnText.textContent = "Écoutez la référence...";
    micBtn.classList.add("hidden");
    return;
  }

  if (isMyTurn) {
    turnText.textContent = "C'est ton tour ! Écoute la référence puis lance ton micro.";
    if (!recordingLocked) micBtn.classList.remove("hidden");
  } else {
    turnText.textContent = `Au tour de ${current.name}`;
    micBtn.classList.add("hidden");
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const params = new URLSearchParams(location.search);
const roomFromLink = params.get("room");

if (roomFromLink) {
  homeCodeInput.value = roomFromLink.toUpperCase();
  openNameScreen("join", roomFromLink);
}