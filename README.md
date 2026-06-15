# Planning Poker
 Echtzeit-Schätzung von Story Points mit Fibonacci-Deck.

## Features
- Räume erstellen/beitreten – 6-stelliger Code, Teilen via Link
- Echtzeit-Synchronisation – Supabase Realtime (postgres_changes + Polling-Fallback)
- Spieler sehen wer schon gewählt hat (✓ Bereit / Wählt...)
- Gleichzeitiges Aufdecken – 3D-Flip-Animation in zufälliger Reihenfolge
- Host-Funktionen – Aufdecken, Neue Runde, Leave-Bestätigung bei >1 Spieler
- Fibonaci-Deck – 1, 2, 3, 5, 8, 13, 20, 40, 100, ?, ☕
- deutsche UI – Dark Theme, responsiv (Desktop + Mobile)
- Keine Anmeldung – Nur Name eingeben, loslegen

## Technik
Framework: Svelte 5 + Vite
Backend: Supabase (PostgreSQL + Realtime)
Hosting: GitHub Pages (via Actions)
TURN: Metered Relay (TCP/443-Fallback für Firewalls)

