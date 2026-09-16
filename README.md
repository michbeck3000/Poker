# Scrum Poker

Planning Poker App für Scrum-Teams – Karten ziehen, schätzen, revealen.

**Live:** https://michbeck3000.github.io/Poker/

## Features

- Echtzeit-Sync via Supabase (WebSocket Realtime + Polling-Fallback)
- Klassische Planning-Poker-Kartenwerte (1, 2, 3, 5, 8, 13, 20, 40, 100, ?, ☕)
- Raum erstellen / beitreten per Code
- Karten aufdecken (Reveal) und neue Runde starten
- Emoji-Würfe auf Mitspieler
- Namens-Marquee bei langen Namen
- Dark Theme
- Mobile-first (iPhone + Desktop)

## Tech Stack

- **Frontend:** Svelte 5 (Reactivity), Vite
- **Backend:** Supabase (PostgreSQL + Realtime)
- **Deployment:** GitHub Pages (gh-pages)
- **RPCs:** Atomare SQL-Funktionen mit Row-Locking (kein Race Condition)

## Development

```bash
npm install
npm run dev
```

Build:
```bash
npm run build
```

## License

MIT License – siehe [LICENSE](LICENSE).
