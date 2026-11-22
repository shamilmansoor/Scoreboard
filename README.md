# Scoreboard

A scoreboard for table tennis that you keep on one phone or tablet and show on any number of other screens.

Start a match on the scoring device and it gets a 4-letter code. Open the page on a TV, laptop or another phone, enter the code, and that screen follows every point live.

## Features

- Singles and doubles, games to 11 or 21, one game or best of 3, 5 or 7
- ITTF serve rules: serve changes every 2 points (every 5 in 21-point games), every point at deuce, and the correct doubles rotation
- Ends change between games and at the midpoint of the deciding game
- Game point, match point and deuce notices
- Top-view table showing who serves to whom, or large buttons for scoring on a phone
- Undo, swap ends, coin toss for serve
- Light and dark themes, sound effects, full screen
- The match is saved in the browser, so a reload doesn't lose it

## Using it

1. Choose **New match** under Table tennis, set the format and player names, and start.
2. Tap a side of the table (or use the arrow keys) to give it the point.
3. Share the code shown on the scoring device. Other screens enter it under **Join a match**.
4. **Close match** ends the code and sends every joined screen back to the start page.

### Keyboard shortcuts

| Key | Action |
|---|---|
| ← / → | Point to the left / right side |
| Z | Undo the last point |
| S | Swap ends |
| M | Sound on or off |
| T | Light or dark theme |
| F | Full screen (double-click on a joined screen) |
| ? | Show the shortcuts |

## Running it

It is a static site: `index.html`, `app.js` and `style.css`, with no build step and no dependencies.

- **Locally:** open `index.html` in a browser, or serve the folder with any static file server.
- **Hosting:** deploy the folder as-is to any static host, such as Vercel, Netlify or GitHub Pages.

## Syncing between devices

Joined screens follow the scoring device through a shared sync service, which the app uses when one is available. Without it, the app falls back to syncing between tabs of the same browser on the same device, and the start page says so.

On a standard static host there is no sync service yet, so cross-device joining needs a backend such as Firebase Firestore. Adding Firestore support is planned.
