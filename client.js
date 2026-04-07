const ATTRIBUTES = [
  { key: "totalMovies", label: "Total Movies" },
  { key: "hits", label: "Hits" },
  { key: "flops", label: "Flops" },
  { key: "heightCm", label: "Height (cm)" },
  { key: "imdbStarmeter", label: "IMDb Starmeter" },
];

const storageKey = "hero-showdown-session";

const elements = {
  playerName: document.getElementById("playerName"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  startMatchBtn: document.getElementById("startMatchBtn"),
  leaveRoomBtn: document.getElementById("leaveRoomBtn"),
  connectionHint: document.getElementById("connectionHint"),
  statusMessage: document.getElementById("statusMessage"),
  roomDisplay: document.getElementById("roomDisplay"),
  turnLabel: document.getElementById("turnLabel"),
  selfName: document.getElementById("selfName"),
  selfDeckCount: document.getElementById("selfDeckCount"),
  selfCard: document.getElementById("selfCard"),
  opponentName: document.getElementById("opponentName"),
  opponentDeckCount: document.getElementById("opponentDeckCount"),
  attributeButtons: document.getElementById("attributeButtons"),
  lastRoundPanel: document.getElementById("lastRoundPanel"),
  historyList: document.getElementById("historyList"),
};

const session = {
  roomCode: "",
  token: "",
  pollId: null,
  state: null,
  selectedAttributeKey: "",
  lastResolvedRoundKey: "",
  revealActive: false,
  revealTimerId: null,
};

let audioContext = null;

initialize();

function initialize() {
  renderAttributeButtons();
  attachEvents();
  restoreSession();
  updateConnectionHint();
  startPolling();
}

function attachEvents() {
  elements.createRoomBtn.addEventListener("click", createRoom);
  elements.joinRoomBtn.addEventListener("click", joinRoom);
  elements.startMatchBtn.addEventListener("click", startMatch);
  elements.leaveRoomBtn.addEventListener("click", leaveRoom);
}

function renderAttributeButtons() {
  elements.attributeButtons.innerHTML = "";

  ATTRIBUTES.forEach((attribute) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = attribute.label;
    button.disabled = true;
    button.addEventListener("click", () => selectAttribute(attribute.key));
    elements.attributeButtons.appendChild(button);
  });
}

function updateConnectionHint() {
  elements.connectionHint.textContent =
    `Open this app on both devices using ${window.location.origin}.`;
}

function getPlayerName() {
  const value = elements.playerName.value.trim();
  return value || "Player";
}

async function createRoom() {
  const response = await postJson("/api/rooms/create", { playerName: getPlayerName() });

  if (!response.ok) {
    setStatus(response.error || "Could not create room.");
    return;
  }

  setSession(response.roomCode, response.token);
  elements.roomCodeInput.value = response.roomCode;
  setStatus(`Room ${response.roomCode} created. Share this code with the other player.`);
  await refreshState();
}

async function joinRoom() {
  const roomCode = elements.roomCodeInput.value.trim().toUpperCase();
  if (!roomCode) {
    setStatus("Enter a room code first.");
    return;
  }

  const response = await postJson("/api/rooms/join", {
    roomCode,
    playerName: getPlayerName(),
  });

  if (!response.ok) {
    setStatus(response.error || "Could not join room.");
    return;
  }

  setSession(response.roomCode, response.token);
  setStatus(`Joined room ${response.roomCode}. Waiting for the host to start.`);
  await refreshState();
}

async function startMatch() {
  if (!session.token) {
    setStatus("Create or join a room first.");
    return;
  }

  const response = await postJson("/api/rooms/start", {
    roomCode: session.roomCode,
    token: session.token,
  });

  if (!response.ok) {
    setStatus(response.error || "Could not start the match.");
    return;
  }

  await refreshState();
}

async function selectAttribute(attributeKey) {
  if (!session.token) {
    return;
  }

  session.selectedAttributeKey = attributeKey;
  updateControls(session.state, getDisplayedSelfCard());

  const response = await postJson("/api/rooms/select-attribute", {
    roomCode: session.roomCode,
    token: session.token,
    attributeKey,
  });

  if (!response.ok) {
    session.selectedAttributeKey = "";
    updateControls(session.state, getDisplayedSelfCard());
    setStatus(response.error || "Could not play that round.");
    return;
  }

  await refreshState();
}

function leaveRoom() {
  clearSession();
  renderDisconnectedView();
  setStatus("You left the room.");
}

function setSession(roomCode, token) {
  session.roomCode = roomCode;
  session.token = token;
  localStorage.setItem(storageKey, JSON.stringify({ roomCode, token }));
}

function clearSession() {
  session.roomCode = "";
  session.token = "";
  session.state = null;
  session.selectedAttributeKey = "";
  session.lastResolvedRoundKey = "";
  session.revealActive = false;
  clearRevealTimer();
  localStorage.removeItem(storageKey);
}

function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (!saved?.roomCode || !saved?.token) {
      return;
    }

    session.roomCode = saved.roomCode;
    session.token = saved.token;
    elements.roomCodeInput.value = saved.roomCode;
  } catch (error) {
    clearSession();
  }
}

function startPolling() {
  if (session.pollId) {
    clearInterval(session.pollId);
  }

  session.pollId = setInterval(() => {
    refreshState();
  }, 1500);

  refreshState();
}

async function refreshState() {
  if (!session.roomCode || !session.token) {
    updateControls(null);
    return;
  }

  try {
    const response = await fetch(
      `/api/rooms/state?roomCode=${encodeURIComponent(session.roomCode)}&token=${encodeURIComponent(session.token)}`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      clearSession();
      renderDisconnectedView();
      setStatus("Session expired. Create or join a room again.");
      return;
    }

    const state = await response.json();
    session.state = state;
    renderState(state);
  } catch (error) {
    setStatus("Trying to reconnect to the local game server...");
  }
}

function renderState(state) {
  handleRoundTransition(state);

  elements.roomDisplay.textContent = state.roomCode;
  elements.selfName.textContent = state.self.name;
  elements.selfDeckCount.textContent = `${state.self.deckCount} cards`;
  elements.opponentName.textContent = state.opponent.name || "Waiting for opponent";
  elements.opponentDeckCount.textContent = `${state.opponent.deckCount} cards`;
  elements.turnLabel.textContent = getTurnMessage(state);

  renderOwnCard(getDisplayedSelfCard());
  renderLastRound(state.lastRound);
  renderHistory(state.history);
  updateControls(state, getDisplayedSelfCard());

  if (state.status === "waiting") {
    setStatus("Room ready. Ask the second player to join with the room code.");
  } else if (state.status === "active") {
    setStatus(state.isYourTurn ? "Your turn. Pick an attribute." : "Opponent is choosing an attribute.");
  } else if (state.status === "finished") {
    setStatus(state.winnerName === state.self.name ? "You won the match." : `${state.winnerName} won the match.`);
  }
}

function renderDisconnectedView() {
  elements.roomDisplay.textContent = "Not connected";
  elements.turnLabel.textContent = "Waiting for players";
  elements.selfName.textContent = "Player";
  elements.selfDeckCount.textContent = "0 cards";
  elements.opponentName.textContent = "Waiting...";
  elements.opponentDeckCount.textContent = "0 cards";
  elements.selfCard.className = "battle-card empty-card";
  elements.selfCard.innerHTML = "<p>Your active card will appear here</p>";
  elements.lastRoundPanel.innerHTML = "<p>No round played yet.</p>";
  elements.historyList.innerHTML = "<li>No rounds played yet.</li>";
  session.selectedAttributeKey = "";
  updateControls(null, null);
}

function renderOwnCard(card) {
  if (!card) {
    elements.selfCard.className = "battle-card empty-card";
    elements.selfCard.innerHTML = "<p>No cards left</p>";
    return;
  }

  elements.selfCard.className = "battle-card card-ready";
  elements.selfCard.innerHTML = buildCardMarkup(card, `${card.role} - Your active card`);
}

function buildCardMarkup(card, subtitle) {
  const imageMarkup = card.image
    ? `<img class="card-image" src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}" />`
    : `<div class="card-image card-image-fallback">Photo not found</div>`;

  return `
    ${imageMarkup}
    <div class="card-header">
      <div>
        <h4>${escapeHtml(card.name)}</h4>
        <p class="card-role">${escapeHtml(subtitle)}</p>
      </div>
      <div class="card-badge">Top Card</div>
    </div>
  `;
}

function renderLastRound(lastRound) {
  if (!lastRound) {
    elements.lastRoundPanel.innerHTML = "<p>No round played yet.</p>";
    elements.lastRoundPanel.className = "last-round-panel";
    return;
  }

  elements.lastRoundPanel.className = `last-round-panel ${session.revealActive ? "round-reveal-active" : ""}`;
  elements.lastRoundPanel.innerHTML = `
    <p>${escapeHtml(lastRound.message)}</p>
    <div class="reveal-grid">
      ${buildRevealMarkup(lastRound.selfCard, "Your round card", lastRound.attributeKey, getRevealOutcome(lastRound, "self"), true)}
      ${buildRevealMarkup(lastRound.opponentCard, "Opponent round card", lastRound.attributeKey, getRevealOutcome(lastRound, "opponent"), true)}
    </div>
  `;
}

function buildRevealMarkup(card, label, attributeKey, outcome, shouldFlip) {
  if (!card) {
    return '<div class="reveal-card"><p>No card data available.</p></div>';
  }

  const imageMarkup = card.image
    ? `<img src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}" />`
    : `<div class="card-image card-image-fallback">Photo not found</div>`;
  const frontFace = `
    <div class="reveal-face reveal-face-front">
      <div class="reveal-card-backdrop"></div>
      <p class="label">Hidden card</p>
      <h4>Reveal</h4>
    </div>
  `;
  const backFace = `
    <div class="reveal-face reveal-face-back">
      <div class="reveal-burst"></div>
      ${imageMarkup}
      <p class="label">${escapeHtml(label)}</p>
      <h4>${escapeHtml(card.name)}</h4>
      <p class="muted">${escapeHtml(card.role)}</p>
      <p class="reveal-stat ${session.selectedAttributeKey === attributeKey ? "reveal-stat-active" : ""}">
        <strong>${escapeHtml(getAttributeLabel(attributeKey))}:</strong> ${formatStat(card[attributeKey])}
      </p>
    </div>
  `;

  return `
    <article class="reveal-card reveal-${escapeHtml(outcome)} ${shouldFlip ? "reveal-card-flip" : ""}">
      <div class="reveal-card-inner ${session.revealActive && shouldFlip ? "is-flipped" : ""}">
        ${frontFace}
        ${backFace}
      </div>
    </article>
  `;
}

function renderHistory(history) {
  elements.historyList.innerHTML = "";

  if (!history?.length) {
    elements.historyList.innerHTML = "<li>No rounds played yet.</li>";
    return;
  }

  history.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = entry;
    elements.historyList.appendChild(item);
  });
}

function updateControls(state, card) {
  const canCreateOrJoin = !session.token;
  elements.createRoomBtn.disabled = !canCreateOrJoin;
  elements.joinRoomBtn.disabled = !canCreateOrJoin;
  elements.leaveRoomBtn.disabled = !session.token;
  elements.startMatchBtn.disabled = !state || !state.canStart;

  const canPickAttribute = Boolean(
    state && state.status === "active" && state.isYourTurn && !session.revealActive
  );
  elements.attributeButtons.querySelectorAll("button").forEach((button, index) => {
    button.disabled = !canPickAttribute;
    const attribute = ATTRIBUTES[index];
    const value = card ? formatStat(card[attribute.key]) : "--";
    button.classList.toggle("selected-property", session.selectedAttributeKey === attribute.key);
    button.innerHTML = `
      <span class="attribute-label">${escapeHtml(attribute.label)}</span>
      <span class="attribute-value">${escapeHtml(value)}</span>
    `;
  });
}

function getTurnMessage(state) {
  if (state.status === "waiting") {
    return "Waiting for both players to join";
  }

  if (state.status === "finished") {
    return `${state.winnerName} won the match`;
  }

  if (session.revealActive && state.lastRound) {
    return "Round revealed. Preparing the next turn...";
  }

  return state.isYourTurn ? "Your turn to choose a stat" : `${state.opponent.name} is choosing a stat`;
}

function getAttributeLabel(attributeKey) {
  return ATTRIBUTES.find((attribute) => attribute.key === attributeKey)?.label || attributeKey;
}

function formatStat(value) {
  return Number.isInteger(value) ? String(value) : Number(value || 0).toFixed(2);
}

function setStatus(message) {
  elements.statusMessage.textContent = message;
}

async function postJson(url, payload) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    return { ok: response.ok, ...data };
  } catch (error) {
    return { ok: false, error: "The app could not reach the local game server." };
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function handleRoundTransition(state) {
  const roundKey = getRoundKey(state.lastRound);

  if (!roundKey) {
    session.revealActive = false;
    session.lastResolvedRoundKey = "";
    return;
  }

  if (roundKey === session.lastResolvedRoundKey) {
    return;
  }

  session.lastResolvedRoundKey = roundKey;
  session.selectedAttributeKey = state.lastRound.attributeKey;
  session.revealActive = true;
  playRoundSound(state.lastRound);
  clearRevealTimer();
  session.revealTimerId = window.setTimeout(() => {
    session.revealActive = false;
    session.selectedAttributeKey = "";
    if (session.state) {
      renderState(session.state);
    }
  }, 1800);
}

function clearRevealTimer() {
  if (session.revealTimerId) {
    window.clearTimeout(session.revealTimerId);
    session.revealTimerId = null;
  }
}

function getRoundKey(lastRound) {
  if (!lastRound) {
    return "";
  }

  return [
    lastRound.attributeKey,
    lastRound.message,
    lastRound.selfCard?.name || "",
    lastRound.opponentCard?.name || "",
  ].join("|");
}

function getDisplayedSelfCard() {
  if (session.revealActive && session.state?.lastRound?.selfCard) {
    return session.state.lastRound.selfCard;
  }

  return session.state?.self?.card || null;
}

function getRevealOutcome(lastRound, side) {
  if (!lastRound || lastRound.winnerSide === "tie") {
    return "tie";
  }

  if (lastRound.winnerSide === side) {
    return "winner";
  }

  return "loser";
}

function playRoundSound(lastRound) {
  if (!lastRound) {
    return;
  }

  const outcome = getRevealOutcome(lastRound, "self");
  if (outcome === "winner") {
    playVictorySound();
    return;
  }

  if (outcome === "loser") {
    playDefeatSound();
  }
}

function playVictorySound() {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }

  const now = ctx.currentTime;
  playTone(ctx, 523.25, now, 0.12, "triangle", 0.07);
  playTone(ctx, 659.25, now + 0.11, 0.12, "triangle", 0.08);
  playTone(ctx, 783.99, now + 0.22, 0.2, "triangle", 0.09);
}

function playDefeatSound() {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }

  const now = ctx.currentTime;
  playTone(ctx, 260.0, now, 0.14, "sine", 0.04);
  playTone(ctx, 196.0, now + 0.12, 0.22, "sine", 0.05);
}

function getAudioContext() {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    return null;
  }

  if (!audioContext) {
    audioContext = new AudioContextCtor();
  }

  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }

  return audioContext;
}

function playTone(ctx, frequency, startAt, duration, type, gainValue) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(gainValue, startAt + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.03);
}
