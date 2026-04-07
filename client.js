const ATTRIBUTES = [
  { key: "totalMovies", label: "Total Movies" },
  { key: "hits", label: "Hits" },
  { key: "flops", label: "Flops" },
  { key: "heightCm", label: "Height (cm)" },
  { key: "imdbStarmeter", label: "IMDb Starmeter" },
];

const storageKey = "hero-showdown-session";

const elements = {
  lobbyPage: document.getElementById("lobbyPage"),
  gamePage: document.getElementById("gamePage"),
  playerName: document.getElementById("playerName"),
  roomCodeInput: document.getElementById("roomCodeInput"),
  createRoomBtn: document.getElementById("createRoomBtn"),
  joinRoomBtn: document.getElementById("joinRoomBtn"),
  startMatchBtn: document.getElementById("startMatchBtn"),
  leaveRoomBtn: document.getElementById("leaveRoomBtn"),
  backToLobbyBtn: document.getElementById("backToLobbyBtn"),
  nextRoundBtn: document.getElementById("nextRoundBtn"),
  connectionHint: document.getElementById("connectionHint"),
  statusMessage: document.getElementById("statusMessage"),
  roomDisplay: document.getElementById("roomDisplay"),
  turnLabel: document.getElementById("turnLabel"),
  selfName: document.getElementById("selfName"),
  selfDeckCount: document.getElementById("selfDeckCount"),
  selfCard: document.getElementById("selfCard"),
  opponentName: document.getElementById("opponentName"),
  opponentDeckCount: document.getElementById("opponentDeckCount"),
  roundOverlay: document.getElementById("roundOverlay"),
  overlayTitle: document.getElementById("overlayTitle"),
  overlayMessage: document.getElementById("overlayMessage"),
  overlayCards: document.getElementById("overlayCards"),
};

const session = {
  roomCode: "",
  token: "",
  pollId: null,
  state: null,
  selectedAttributeKey: "",
  lastResolvedRoundKey: "",
  revealActive: false,
  pendingNext: false,
  renderedOverlayRoundKey: "",
  nextRoundClicked: false,
};

let audioContext = null;

initialize();

function initialize() {
  attachEvents();
  restoreSession();
  updateConnectionHint();
  renderDisconnectedView();
  startPolling();
}

function attachEvents() {
  elements.createRoomBtn.addEventListener("click", createRoom);
  elements.joinRoomBtn.addEventListener("click", joinRoom);
  elements.startMatchBtn.addEventListener("click", startMatch);
  elements.leaveRoomBtn.addEventListener("click", leaveRoom);
  elements.backToLobbyBtn.addEventListener("click", showLobbyPage);
  elements.nextRoundBtn.addEventListener("click", goToNextRound);
}

function updateConnectionHint() {
  elements.connectionHint.textContent = `Open this app on both devices using ${window.location.origin}.`;
}

function getPlayerName() {
  return elements.playerName.value.trim() || "Player";
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
  if (!session.token || !session.state || session.pendingNext) {
    return;
  }

  session.selectedAttributeKey = attributeKey;
  renderOwnCard(getDisplayedSelfCard());

  const response = await postJson("/api/rooms/select-attribute", {
    roomCode: session.roomCode,
    token: session.token,
    attributeKey,
  });

  if (!response.ok) {
    session.selectedAttributeKey = "";
    renderOwnCard(getDisplayedSelfCard());
    setStatus(response.error || "Could not play that round.");
    return;
  }

  await refreshState();
}

async function goToNextRound() {
  if (session.state?.status === "finished") {
    session.revealActive = false;
    session.pendingNext = false;
    session.selectedAttributeKey = "";
    session.renderedOverlayRoundKey = "";
    renderState(session.state);
    return;
  }

  if (!session.token || !session.state?.lastRound) {
    return;
  }

  session.nextRoundClicked = true;
  updateLobbyControls(session.state);

  const response = await postJson("/api/rooms/next-round", {
    roomCode: session.roomCode,
    token: session.token,
  });

  if (!response.ok) {
    session.nextRoundClicked = false;
    updateLobbyControls(session.state);
    setStatus(response.error || "Could not continue to the next round.");
    return;
  }

  await refreshState();
}

function leaveRoom() {
  clearSession();
  renderDisconnectedView();
  setStatus("You left the room.");
}

function showLobbyPage() {
  const shouldStayInGame = Boolean(session.state && (session.state.status === "active" || session.pendingNext));
  elements.lobbyPage.classList.toggle("page-active", !shouldStayInGame);
  elements.gamePage.classList.toggle("page-active", shouldStayInGame);
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
  session.pendingNext = false;
  session.renderedOverlayRoundKey = "";
  session.nextRoundClicked = false;
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

  session.pollId = window.setInterval(refreshState, 1500);
  refreshState();
}

async function refreshState() {
  if (!session.roomCode || !session.token) {
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
  if (!state) {
    renderDisconnectedView();
    return;
  }

  handleRoundTransition(state);
  showRelevantPage(state);

  elements.roomDisplay.textContent = state.roomCode;
  elements.selfName.textContent = state.self.name;
  elements.selfDeckCount.textContent = `${state.self.deckCount} cards`;
  elements.opponentName.textContent = state.opponent.name || "Waiting...";
  elements.opponentDeckCount.textContent = `${state.opponent.deckCount} cards`;
  elements.turnLabel.textContent = getTurnMessage(state);

  renderOwnCard(getDisplayedSelfCard());
  renderRoundOverlay(state.lastRound);
  updateLobbyControls(state);

  if (state.status === "waiting") {
    setStatus("Room ready. Ask the second player to join with the room code.");
  } else if (state.status === "active") {
    if (session.pendingNext) {
      setStatus(state.selfReadyNext ? "Waiting for the other player to tap next round." : "Round complete. Tap next round.");
    } else {
      setStatus(state.isYourTurn ? "Your turn. Tap a stat on your card." : "Opponent is choosing a stat.");
    }
  } else if (state.status === "finished") {
    setStatus(state.winnerName === state.self.name ? "You won the match." : `${state.winnerName} won the match.`);
  }
}

function renderDisconnectedView() {
  elements.lobbyPage.classList.add("page-active");
  elements.gamePage.classList.remove("page-active");
  elements.roomDisplay.textContent = "Not connected";
  elements.turnLabel.textContent = "Waiting for players";
  elements.selfName.textContent = "Player";
  elements.selfDeckCount.textContent = "0 cards";
  elements.opponentName.textContent = "Waiting...";
  elements.opponentDeckCount.textContent = "0 cards";
  elements.selfCard.className = "player-card empty-card";
  elements.selfCard.innerHTML = "<p>Your active card will appear here.</p>";
  elements.roundOverlay.classList.remove("overlay-active");
  session.renderedOverlayRoundKey = "";
  session.nextRoundClicked = false;
  updateLobbyControls(null);
}

function showRelevantPage(state) {
  const showGame = state.status === "active" || state.status === "finished" || session.pendingNext;
  elements.lobbyPage.classList.toggle("page-active", !showGame);
  elements.gamePage.classList.toggle("page-active", showGame);
}

function renderOwnCard(card) {
  if (!card) {
    elements.selfCard.className = "player-card empty-card";
    elements.selfCard.innerHTML = "<p>No cards left.</p>";
    return;
  }

  const canPick = Boolean(session.state && session.state.status === "active" && session.state.isYourTurn && !session.pendingNext);
  elements.selfCard.className = "player-card card-live";
  elements.selfCard.innerHTML = `
    ${card.image ? `<img class="card-image" src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}" />` : `<div class="card-image card-image-fallback">Photo not found</div>`}
    <div class="card-content">
      <div class="card-headline">
        <div>
          <p class="label">Your Current Card</p>
          <h2>${escapeHtml(card.name)}</h2>
          <p class="subtle">${escapeHtml(card.role)}</p>
        </div>
        <div class="card-badge">Top Card</div>
      </div>
      <div class="inline-attributes">
        ${ATTRIBUTES.map((attribute) => buildAttributeButton(card, attribute, canPick)).join("")}
      </div>
    </div>
  `;

  elements.selfCard.querySelectorAll("[data-attribute]").forEach((button) => {
    button.addEventListener("click", () => selectAttribute(button.dataset.attribute));
  });
}

function buildAttributeButton(card, attribute, canPick) {
  const isSelected = session.selectedAttributeKey === attribute.key;
  const value = formatStat(card[attribute.key]);
  return `
    <button
      type="button"
      class="attribute-chip ${isSelected ? "selected-property" : ""}"
      data-attribute="${attribute.key}"
      ${canPick ? "" : "disabled"}
    >
      <span class="attribute-label">${escapeHtml(attribute.label)}</span>
      <span class="attribute-value">${escapeHtml(value)}</span>
    </button>
  `;
}

function renderRoundOverlay(lastRound) {
  if (!lastRound || !session.pendingNext) {
    elements.roundOverlay.classList.remove("overlay-active");
    elements.roundOverlay.setAttribute("aria-hidden", "true");
    session.renderedOverlayRoundKey = "";
    return;
  }

  const roundKey = getRoundKey(lastRound);
  if (session.renderedOverlayRoundKey !== roundKey) {
    elements.overlayTitle.textContent = session.state?.status === "finished" ? "Match Result" : "Round Result";
    elements.overlayMessage.textContent = lastRound.message;
    elements.overlayCards.innerHTML = `
      ${buildRevealMarkup(lastRound.selfCard, "Your card", lastRound.attributeKey, getRevealOutcome(lastRound, "self"), true)}
      ${buildRevealMarkup(lastRound.opponentCard, "Opponent card", lastRound.attributeKey, getRevealOutcome(lastRound, "opponent"), true)}
    `;
    session.renderedOverlayRoundKey = roundKey;
  }
  if (session.state?.status === "finished") {
    elements.nextRoundBtn.textContent = "Close Result";
  } else if (session.state?.selfReadyNext) {
    elements.nextRoundBtn.textContent = session.state?.opponentReadyNext ? "Loading next round..." : "Waiting for opponent...";
  } else {
    elements.nextRoundBtn.textContent = "Next Round";
  }
  elements.roundOverlay.classList.add("overlay-active");
  elements.roundOverlay.setAttribute("aria-hidden", "false");
}

function buildRevealMarkup(card, label, attributeKey, outcome, animateFlip) {
  if (!card) {
    return `<article class="reveal-card"><p>No card data available.</p></article>`;
  }

  return `
    <article class="reveal-card reveal-${escapeHtml(outcome)} reveal-card-flip">
      <div class="reveal-card-inner is-flipped ${animateFlip ? "animate-flip" : ""}">
        <div class="reveal-face reveal-face-front">
          <div class="reveal-card-backdrop"></div>
          <p class="label">Hidden card</p>
          <h4>Reveal</h4>
        </div>
        <div class="reveal-face reveal-face-back">
          <div class="reveal-burst"></div>
          ${card.image ? `<img class="overlay-photo" src="${escapeHtml(card.image)}" alt="${escapeHtml(card.name)}" />` : `<div class="card-image card-image-fallback">Photo not found</div>`}
          <p class="label">${escapeHtml(label)}</p>
          <h3>${escapeHtml(card.name)}</h3>
          <p class="subtle">${escapeHtml(card.role)}</p>
          <p class="reveal-stat reveal-stat-active">
            <strong>${escapeHtml(getAttributeLabel(attributeKey))}:</strong> ${formatStat(card[attributeKey])}
          </p>
        </div>
      </div>
    </article>
  `;
}

function handleRoundTransition(state) {
  const roundKey = getRoundKey(state.lastRound);
  if (!roundKey) {
    session.revealActive = false;
    session.pendingNext = false;
    session.selectedAttributeKey = "";
    session.renderedOverlayRoundKey = "";
    session.nextRoundClicked = false;
    return;
  }

  if (roundKey === session.lastResolvedRoundKey) {
    return;
  }

  session.lastResolvedRoundKey = roundKey;
  session.selectedAttributeKey = state.lastRound.attributeKey;
  session.revealActive = true;
  session.pendingNext = true;
  session.nextRoundClicked = false;
  session.renderedOverlayRoundKey = "";
  playRoundSound(state.lastRound);
}

function getDisplayedSelfCard() {
  if (session.pendingNext && session.state?.lastRound?.selfCard) {
    return session.state.lastRound.selfCard;
  }
  return session.state?.self?.card || null;
}

function updateLobbyControls(state) {
  const canCreateOrJoin = !session.token;
  elements.createRoomBtn.disabled = !canCreateOrJoin;
  elements.joinRoomBtn.disabled = !canCreateOrJoin;
  elements.leaveRoomBtn.disabled = !session.token;
  elements.startMatchBtn.disabled = !state || !state.canStart;
  elements.nextRoundBtn.disabled = !session.pendingNext || (Boolean(state?.selfReadyNext) && state?.status !== "finished");
}

function getTurnMessage(state) {
  if (state.status === "waiting") {
    return "Waiting for both players to join";
  }
  if (state.status === "finished") {
    return `${state.winnerName} won the match`;
  }
  if (session.pendingNext) {
    return "Round complete. Reveal both cards and continue.";
  }
  return state.isYourTurn ? "Tap one stat on your card" : `${state.opponent.name} is choosing a stat`;
}

function getAttributeLabel(attributeKey) {
  return ATTRIBUTES.find((attribute) => attribute.key === attributeKey)?.label || attributeKey;
}

function getRoundKey(lastRound) {
  if (!lastRound) {
    return "";
  }
  return [lastRound.attributeKey, lastRound.message, lastRound.selfCard?.name || "", lastRound.opponentCard?.name || ""].join("|");
}

function getRevealOutcome(lastRound, side) {
  if (!lastRound || lastRound.winnerSide === "tie") {
    return "tie";
  }
  return lastRound.winnerSide === side ? "winner" : "loser";
}

function playRoundSound(lastRound) {
  if (!lastRound) {
    return;
  }

  const outcome = getRevealOutcome(lastRound, "self");
  if (outcome === "winner") {
    playVictorySound();
  } else if (outcome === "loser") {
    playDefeatSound();
  }
}

function playVictorySound() {
  const ctx = getAudioContext();
  if (!ctx) {
    return;
  }
  const now = ctx.currentTime;
  playTone(ctx, 523.25, now, 0.12, "triangle", 0.06);
  playTone(ctx, 659.25, now + 0.08, 0.12, "triangle", 0.07);
  playTone(ctx, 783.99, now + 0.16, 0.16, "triangle", 0.08);
  playTone(ctx, 1046.5, now + 0.28, 0.18, "triangle", 0.1);
  playTone(ctx, 1318.51, now + 0.38, 0.24, "triangle", 0.11);
  playTone(ctx, 1567.98, now + 0.48, 0.28, "triangle", 0.08);
  playTone(ctx, 2093.0, now + 0.58, 0.3, "sine", 0.05);
  playNoiseBurst(ctx, now + 0.12, 0.12, 0.03);
  playNoiseBurst(ctx, now + 0.32, 0.12, 0.025);
  playNoiseBurst(ctx, now + 0.52, 0.14, 0.02);
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
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) {
    return null;
  }
  if (!audioContext) {
    audioContext = new Ctor();
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

function playNoiseBurst(ctx, startAt, duration, gainValue) {
  const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let index = 0; index < bufferSize; index += 1) {
    data[index] = (Math.random() * 2 - 1) * (1 - index / bufferSize);
  }

  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();

  source.buffer = buffer;
  filter.type = "highpass";
  filter.frequency.setValueAtTime(1200, startAt);
  gain.gain.setValueAtTime(gainValue, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  source.start(startAt);
  source.stop(startAt + duration);
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
