import json
import mimetypes
import os
import random
import socket
import threading
import time
import uuid
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
DECK_PATH = ROOT / "data" / "offline-cards.json"
REQUIRED_CARD_COUNT = 20
ATTRIBUTES = {
    "totalMovies": "Total Movies",
    "hits": "Hits",
    "flops": "Flops",
    "heightCm": "Height (cm)",
    "imdbStarmeter": "IMDb Starmeter",
}

ROOMS = {}
ROOM_LOCK = threading.Lock()
DECK = json.loads(DECK_PATH.read_text(encoding="utf-8"))


class HeroShowdownHandler(BaseHTTPRequestHandler):
    server_version = "HeroShowdown/1.0"

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/rooms/state":
            self.handle_room_state(parsed)
            return
        self.serve_static(parsed.path)

    def do_POST(self):
        parsed = urlparse(self.path)
        body = self.read_json_body()

        if parsed.path == "/api/rooms/create":
            self.handle_create_room(body)
            return
        if parsed.path == "/api/rooms/join":
            self.handle_join_room(body)
            return
        if parsed.path == "/api/rooms/start":
            self.handle_start_room(body)
            return
        if parsed.path == "/api/rooms/select-attribute":
            self.handle_select_attribute(body)
            return

        self.send_json({"error": "Not found."}, HTTPStatus.NOT_FOUND)

    def log_message(self, format, *args):
        return

    def read_json_body(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def handle_create_room(self, body):
        player_name = sanitize_name(body.get("playerName"), "Player 1")

        with ROOM_LOCK:
            room_code = generate_room_code()
            token = uuid.uuid4().hex
            ROOMS[room_code] = {
                "code": room_code,
                "players": [{"token": token, "name": player_name}],
                "status": "waiting",
                "current_turn": 0,
                "decks": [[], []],
                "history": [],
                "last_round": None,
                "winner_index": None,
                "created_at": time.time(),
            }

        self.send_json({"roomCode": room_code, "token": token}, HTTPStatus.CREATED)

    def handle_join_room(self, body):
        room_code = str(body.get("roomCode", "")).upper()
        player_name = sanitize_name(body.get("playerName"), "Player 2")

        with ROOM_LOCK:
            room = ROOMS.get(room_code)
            if not room:
                self.send_json({"error": "Room not found."}, HTTPStatus.NOT_FOUND)
                return
            if len(room["players"]) >= 2:
                self.send_json({"error": "Room already has two players."}, HTTPStatus.CONFLICT)
                return
            if room["status"] != "waiting":
                self.send_json({"error": "Match already started."}, HTTPStatus.CONFLICT)
                return

            token = uuid.uuid4().hex
            room["players"].append({"token": token, "name": player_name})

        self.send_json({"roomCode": room_code, "token": token}, HTTPStatus.CREATED)

    def handle_start_room(self, body):
        room, player_index = self.require_room_and_player(body)
        if room is None:
            return

        with ROOM_LOCK:
            if player_index != 0:
                self.send_json({"error": "Only the room creator can start the match."}, HTTPStatus.FORBIDDEN)
                return
            if len(room["players"]) != 2:
                self.send_json({"error": "Both players must join before starting."}, HTTPStatus.CONFLICT)
                return
            if room["status"] != "waiting":
                self.send_json({"error": "Match already started."}, HTTPStatus.CONFLICT)
                return

            cards = [dict(card) for card in random.sample(DECK, REQUIRED_CARD_COUNT)]
            midpoint = REQUIRED_CARD_COUNT // 2
            room["decks"] = [cards[:midpoint], cards[midpoint:]]
            room["status"] = "active"
            room["current_turn"] = 0
            room["history"] = ["Match started. Player 1 chooses the first attribute."]
            room["last_round"] = None
            room["winner_index"] = None

        self.send_json({"ok": True})

    def handle_select_attribute(self, body):
        room, player_index = self.require_room_and_player(body)
        if room is None:
            return

        attribute_key = body.get("attributeKey")
        if attribute_key not in ATTRIBUTES:
            self.send_json({"error": "Invalid attribute."}, HTTPStatus.BAD_REQUEST)
            return

        with ROOM_LOCK:
            if room["status"] != "active":
                self.send_json({"error": "Match is not active."}, HTTPStatus.CONFLICT)
                return
            if player_index != room["current_turn"]:
                self.send_json({"error": "It is not your turn."}, HTTPStatus.FORBIDDEN)
                return
            if not room["decks"][0] or not room["decks"][1]:
                self.send_json({"error": "The match is already over."}, HTTPStatus.CONFLICT)
                return

            current_index = room["current_turn"]
            other_index = 1 - current_index
            current_card = dict(room["decks"][current_index][0])
            other_card = dict(room["decks"][other_index][0])
            current_value = current_card[attribute_key]
            other_value = other_card[attribute_key]
            label = ATTRIBUTES[attribute_key]

            if current_value > other_value:
                room["decks"][current_index].append(room["decks"][current_index].pop(0))
                room["decks"][current_index].append(room["decks"][other_index].pop(0))
                winner_index = current_index
                message = (
                    f"{room['players'][current_index]['name']} wins with {label}: "
                    f"{current_value} vs {other_value}."
                )
            elif other_value > current_value:
                room["decks"][other_index].append(room["decks"][other_index].pop(0))
                room["decks"][other_index].append(room["decks"][current_index].pop(0))
                room["current_turn"] = other_index
                winner_index = other_index
                message = (
                    f"{room['players'][other_index]['name']} wins with {label}: "
                    f"{other_value} vs {current_value}."
                )
            else:
                room["decks"][current_index].append(room["decks"][current_index].pop(0))
                room["decks"][other_index].append(room["decks"][other_index].pop(0))
                room["current_turn"] = other_index
                winner_index = None
                message = f"Tie on {label}: {current_value} each. Both players keep their cards."

            room["last_round"] = {
                "attributeKey": attribute_key,
                "winnerIndex": winner_index,
                "message": message,
                "cards": [current_card, other_card],
                "turnPlayerIndex": current_index,
            }
            room["history"] = [message] + room["history"][:11]

            if not room["decks"][0]:
                room["status"] = "finished"
                room["winner_index"] = 1
            elif not room["decks"][1]:
                room["status"] = "finished"
                room["winner_index"] = 0

            if room["status"] == "finished":
                room["history"] = [
                    f"{room['players'][room['winner_index']]['name']} wins the match."
                ] + room["history"][:11]

        self.send_json({"ok": True})

    def handle_room_state(self, parsed):
        query = parse_qs(parsed.query)
        room_code = get_first(query, "roomCode").upper()
        token = get_first(query, "token")

        with ROOM_LOCK:
            room = ROOMS.get(room_code)
            if not room:
                self.send_json({"error": "Room not found."}, HTTPStatus.NOT_FOUND)
                return

            player_index = find_player_index(room, token)
            if player_index is None:
                self.send_json({"error": "Invalid session."}, HTTPStatus.FORBIDDEN)
                return

            state = build_player_state(room, player_index)

        self.send_json(state)

    def require_room_and_player(self, body):
        room_code = str(body.get("roomCode", "")).upper()
        token = str(body.get("token", ""))

        with ROOM_LOCK:
            room = ROOMS.get(room_code)
            if not room:
                self.send_json({"error": "Room not found."}, HTTPStatus.NOT_FOUND)
                return None, None

            player_index = find_player_index(room, token)
            if player_index is None:
                self.send_json({"error": "Invalid session."}, HTTPStatus.FORBIDDEN)
                return None, None

        return room, player_index

    def serve_static(self, path):
        relative = "index.html" if path == "/" else path.lstrip("/")
        file_path = (ROOT / relative).resolve()

        if ROOT not in file_path.parents and file_path != ROOT:
            self.send_json({"error": "Forbidden."}, HTTPStatus.FORBIDDEN)
            return
        if not file_path.exists() or not file_path.is_file():
            self.send_json({"error": "Not found."}, HTTPStatus.NOT_FOUND)
            return

        content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
        payload = file_path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def send_json(self, payload, status=HTTPStatus.OK):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def build_player_state(room, player_index):
    opponent_index = 1 - player_index
    self_player = room["players"][player_index]
    opponent_player = room["players"][opponent_index] if len(room["players"]) > opponent_index else {"name": ""}
    last_round = room.get("last_round")

    return {
        "roomCode": room["code"],
        "status": room["status"],
        "canStart": player_index == 0 and room["status"] == "waiting" and len(room["players"]) == 2,
        "isYourTurn": room["status"] == "active" and room["current_turn"] == player_index,
        "self": {
            "name": self_player["name"],
            "deckCount": len(room["decks"][player_index]),
            "card": room["decks"][player_index][0] if room["decks"][player_index] else None,
        },
        "opponent": {
            "name": opponent_player["name"],
            "deckCount": len(room["decks"][opponent_index]) if len(room["decks"]) > opponent_index else 0,
        },
        "history": room["history"],
        "lastRound": build_last_round_for_player(last_round, player_index),
        "winnerName": room["players"][room["winner_index"]]["name"] if room["winner_index"] is not None else "",
    }


def build_last_round_for_player(last_round, player_index):
    if not last_round:
        return None

    if player_index == last_round["turnPlayerIndex"]:
        self_card = last_round["cards"][0]
        opponent_card = last_round["cards"][1]
    else:
        self_card = last_round["cards"][1]
        opponent_card = last_round["cards"][0]

    if last_round["winnerIndex"] is None:
        winner_side = "tie"
    elif last_round["winnerIndex"] == player_index:
        winner_side = "self"
    else:
        winner_side = "opponent"

    return {
        "attributeKey": last_round["attributeKey"],
        "winnerIndex": last_round["winnerIndex"],
        "winnerSide": winner_side,
        "message": last_round["message"],
        "selfCard": self_card,
        "opponentCard": opponent_card,
    }


def sanitize_name(value, fallback):
    value = str(value or "").strip()
    return value or fallback


def get_first(query, key):
    return query.get(key, [""])[0]


def find_player_index(room, token):
    for index, player in enumerate(room["players"]):
        if player["token"] == token:
            return index
    return None


def generate_room_code():
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        code = "".join(random.choice(alphabet) for _ in range(6))
        if code not in ROOMS:
            return code


def get_local_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def run():
    host = "0.0.0.0"
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer((host, port), HeroShowdownHandler)
    local_ip = get_local_ip()

    print("Hero Showdown Online is ready.")
    print(f"Open on this device: http://127.0.0.1:{port}")
    print(f"Open on another device in the same network: http://{local_ip}:{port}")
    print("Keep this terminal running while you play.")
    server.serve_forever()


if __name__ == "__main__":
    run()
