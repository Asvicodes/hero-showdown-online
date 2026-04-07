# Hero Showdown Online

A 2-player browser card game for two separate devices on the same local network.

## Run the app

1. Open a terminal in [C:\Users\intel\Desktop\My_Project\TFI BANISA](C:\Users\intel\Desktop\My_Project\TFI BANISA).
2. Run:

```powershell
python .\server.py
```

3. The terminal will print two URLs:
   - one for this device, usually `http://127.0.0.1:8000`
   - one for the second device, using your local network IP
4. Open the app URL in both browsers.

## How to play

1. Player 1 enters a name and clicks `Create Room`.
2. Share the room code with Player 2.
3. Player 2 enters their name, enters the room code, and clicks `Join Room`.
4. Player 1 clicks `Start Match`.
5. The active player chooses one attribute from their current card.
6. Higher value wins both top cards.
7. The loser is the player who runs out of cards.

## Privacy behavior

- Each player only sees their own current card before choosing a stat.
- The opponent card stays hidden until the round is resolved.
- After each round, both round cards are revealed in the battle summary.

## Data source

- The multiplayer app uses the built-in offline deck from [data/offline-cards.json](C:\Users\intel\Desktop\My_Project\TFI BANISA\data\offline-cards.json).
- Local celebrity photos are stored in [assets/celebrities](C:\Users\intel\Desktop\My_Project\TFI BANISA\assets\celebrities).

## Main files

- [server.py](C:\Users\intel\Desktop\My_Project\TFI BANISA\server.py): local multiplayer server
- [client.js](C:\Users\intel\Desktop\My_Project\TFI BANISA\client.js): browser app logic
- [index.html](C:\Users\intel\Desktop\My_Project\TFI BANISA\index.html): UI shell
- [styles.css](C:\Users\intel\Desktop\My_Project\TFI BANISA\styles.css): app styling
