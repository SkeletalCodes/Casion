# Connect 4 Bot

Play Connect 4 against a bot that can't be beaten. There's also Connect 5 on a 9×7 board and
Connect 6 on an 11×8 board, and you choose whether you or the bot moves first.

**To play, open `connect4-bot.html` in any browser.** It's a single file and needs no install,
server or internet connection.

## How strong is it?

- **Connect 4 (7×6): perfect play.** Connect 4 is a solved game, and the bot uses an exact solver
  that never makes a move that worsens its result. Whoever moves first can always force a win, so
  when the bot starts it always wins, and when you start you can only beat it with a perfect game.
- **Connect 5 (9×7) and Connect 6 (11×8): very strong.** Nobody has solved these boards, so no
  bot can promise perfect play on them. This one searches about 10 moves ahead in about two
  seconds and never misses a win or a block inside that search.

The bot thinks in a background worker, so the page never freezes while it does.

## Files

| File | What it is |
| --- | --- |
| `connect4-bot.html` | The finished game: open this one. Built from the files below. |
| `app.html` | The page: board, buttons and game rules. |
| `connect-ai.js` | The bot: the Connect 4 solver and the search for the bigger boards. |
| `connect-book.js` | Precomputed Connect 4 opening moves (the first moves are too slow to solve live). |
| `build.js` | Puts the three files above together into `connect4-bot.html`. |

After changing `app.html`, `connect-ai.js` or `connect-book.js`, rebuild the game with:

```sh
node connect-bot/build.js
```

Tests (no setup needed): `node --test test/connect.test.js`

The opening book only needs rebuilding if the solver changes (about an hour on 4 cores):

```sh
cc -O2 -o /tmp/c4book tools/connect4-book.c
/tmp/c4book 1000000 4 > /tmp/book.txt
node tools/connect4-book.js /tmp/book.txt
node connect-bot/build.js
```
