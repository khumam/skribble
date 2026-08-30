import db from '$lib/db';
import { WORDS } from '$lib/words';

export const ROUNDS = 2; // times each player draws
export const MIN_SEC = 5;
export const MAX_SEC = 120;
export const DEFAULT_MS = 10_000;

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// wordiebox: simple everyday words (sample: [{"Word":"Topi","Meaning":"Hat"}])
const WORD_API = 'https://www.wordiebox.com/api/words?country=indonesian&number=1';

/** Random word from wordiebox, falling back to the local list. */
export async function pickWord(): Promise<string> {
	try {
		const r = await fetch(WORD_API, { signal: AbortSignal.timeout(2500) });
		const d = await r.json();
		const w = String(Array.isArray(d) ? d[0]?.Word ?? '' : '').toLowerCase().trim();
		if (/^[a-z]{2,14}$/.test(w)) return w;
	} catch {}
	return WORDS[Math.floor(Math.random() * WORDS.length)];
}

export function normalizeText(s: unknown): string {
	return String(s ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9 ]/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function makeCode(): string {
	let code = '';
	for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
	return code;
}

const roomByCode = db.prepare('SELECT * FROM rooms WHERE code = ?');

export function createRoom(hostName: string): { code: string; playerId: number } {
	const name = normalizeText(hostName).slice(0, 20) || 'Host';
	let code = makeCode();
	while (roomByCode.get(code)) code = makeCode();

	const tx = db.transaction(() => {
		db.prepare('INSERT INTO rooms (code) VALUES (?)').run(code);
		const r = db
			.prepare('INSERT INTO players (room_code, name, is_host) VALUES (?, ?, 1)')
			.run(code, name);
		return { code, playerId: Number(r.lastInsertRowid) };
	});
	return tx();
}

export function joinRoom(code: string, playerName: string): { playerId: number } | null {
	const room = roomByCode.get(code) as any;
	if (!room) return null;
	const name = normalizeText(playerName).slice(0, 20) || 'Player';
	// If a player with this name already exists, treat as rejoin (return them)
	const existing = db
		.prepare('SELECT id FROM players WHERE room_code = ? AND name = ?')
		.get(code, name) as any;
	if (existing) return { playerId: existing.id };
	const r = db.prepare('INSERT INTO players (room_code, name) VALUES (?, ?)').run(code, name);
	return { playerId: Number(r.lastInsertRowid) };
}

export function getPlayers(code: string) {
	return db.prepare('SELECT * FROM players WHERE room_code = ? ORDER BY id').all(code) as any[];
}

function drawerOf(room: any, players: any[]) {
	return players[room.turn_index % players.length];
}

function clampMs(sec: unknown): number {
	const n = Math.round(Number(sec));
	if (!Number.isFinite(n)) return DEFAULT_MS;
	return Math.max(MIN_SEC, Math.min(MAX_SEC, n)) * 1000;
}

export function updateSettings(
	code: string,
	playerId: number,
	drawSec: unknown,
	guessSec: unknown
): boolean {
	const room = roomByCode.get(code) as any;
	if (!room) return false;
	const players = getPlayers(code);
	if (players[0]?.id !== playerId) return false; // host only
	if (room.state === 'playing') return false; // only between games
	db.prepare('UPDATE rooms SET draw_ms = ?, guess_ms = ? WHERE code = ?').run(
		clampMs(drawSec),
		clampMs(guessSec),
		code
	);
	return true;
}

export async function startGame(code: string, playerId: number): Promise<boolean> {
	const room = roomByCode.get(code) as any;
	if (!room) return false;
	const players = getPlayers(code);
	if (players.length < 2) return false;
	if (players[0].id !== playerId) return false; // host only
	if (room.state === 'playing') return false;

	const word = await pickWord();
	const tx = db.transaction(() => {
		db.prepare('DELETE FROM strokes WHERE room_code = ?').run(code);
		db.prepare(
			`UPDATE rooms SET state = 'playing', phase = 'draw', round = 1, turn_index = 0,
			 word = ?, deadline = ? WHERE code = ?`
		).run(word, Date.now() + room.draw_ms, code);
		db.prepare('UPDATE players SET score = 0, guessed = 0 WHERE room_code = ?').run(code);
	});
	tx();
	return true;
}

/** Advance to the next player. Manual only (host or drawer clicks "next"). */
export async function nextPlayer(code: string, playerId: number): Promise<boolean> {
	const room = roomByCode.get(code) as any;
	if (!room || room.state !== 'playing' || room.phase !== 'wait') return false;
	const players = getPlayers(code);
	const drawer = drawerOf(room, players);
	const isHost = players[0]?.id === playerId;
	if (!isHost && drawer?.id !== playerId) return false;

	const next = room.turn_index + 1;
	const totalTurns = players.length * ROUNDS;
	if (next >= totalTurns) {
		const tx = db.transaction(() => {
			db.prepare(
				`UPDATE rooms SET state = 'ended', phase = 'wait', word = NULL, deadline = 0 WHERE code = ?`
			).run(code);
			db.prepare('UPDATE players SET guessed = 0 WHERE room_code = ?').run(code);
		});
		tx();
		return true;
	}

	const word = await pickWord();
	const tx = db.transaction(() => {
		db.prepare('DELETE FROM strokes WHERE room_code = ?').run(code);
		db.prepare(
			`UPDATE rooms SET turn_index = ?, round = ?, word = ?, phase = 'draw', deadline = ? WHERE code = ?`
		).run(
			next,
			Math.floor(next / players.length) + 1,
			word,
			Date.now() + room.draw_ms,
			code
		);
		db.prepare('UPDATE players SET guessed = 0 WHERE room_code = ?').run(code);
	});
	tx();
	return true;
}

/** Auto phase transitions when deadline passes. 'wait' never auto-ticks. */
export function maybeTick(code: string) {
	const room = roomByCode.get(code) as any;
	if (!room || room.state !== 'playing') return;
	if (room.phase === 'wait' || Date.now() < room.deadline) return;

	if (room.phase === 'draw') {
		db.prepare(`UPDATE rooms SET phase = 'guess', deadline = ? WHERE code = ?`).run(
			Date.now() + room.guess_ms,
			code
		);
	} else if (room.phase === 'guess') {
		db.prepare(`UPDATE rooms SET phase = 'wait', deadline = 0 WHERE code = ?`).run(code);
	}
}

function endGuessPhaseIfAllGuessed(code: string, drawerId: number) {
	const players = getPlayers(code);
	const guessers = players.filter((p) => p.id !== drawerId);
	if (guessers.length > 0 && guessers.every((p) => p.guessed)) {
		db.prepare(`UPDATE rooms SET phase = 'wait', deadline = 0 WHERE code = ?`).run(code);
	}
}

export function makeGuess(
	code: string,
	playerId: number,
	rawGuess: string
): { ok: boolean; correct?: boolean; error?: string } {
	const room = roomByCode.get(code) as any;
	if (!room || room.state !== 'playing' || room.phase !== 'guess') {
		return { ok: false, error: 'not guessing now' };
	}

	const players = getPlayers(code);
	const me = players.find((p) => p.id === playerId);
	if (!me) return { ok: false, error: 'no player' };

	const drawer = drawerOf(room, players);
	if (drawer && drawer.id === playerId) return { ok: false, error: 'drawer' };
	if (me.guessed) return { ok: false, error: 'already guessed' };

	const guess = normalizeText(rawGuess);
	if (!guess) return { ok: false, error: 'empty' };

	if (guess === normalizeText(room.word)) {
		const tx = db.transaction(() => {
			db.prepare('UPDATE players SET score = score + 1, guessed = 1 WHERE id = ?').run(playerId);
			endGuessPhaseIfAllGuessed(code, drawer.id);
		});
		tx();
		return { ok: true, correct: true };
	}
	return { ok: true, correct: false };
}

type Stroke = { color: string; size: number; path: [number, number][] };

export function addStroke(code: string, playerId: number, stroke: Stroke): boolean {
	const room = roomByCode.get(code) as any;
	if (!room || room.state !== 'playing' || room.phase !== 'draw') return false;
	const players = getPlayers(code);
	const drawer = drawerOf(room, players);
	if (!drawer || drawer.id !== playerId) return false;

	db.prepare('INSERT INTO strokes (room_code, round, color, size, path) VALUES (?, ?, ?, ?, ?)').run(
		code,
		room.round,
		stroke.color,
		stroke.size,
		JSON.stringify(stroke.path)
	);
	return true;
}

export function clearCanvas(code: string, playerId: number): boolean {
	const room = roomByCode.get(code) as any;
	if (!room || room.state !== 'playing' || room.phase !== 'draw') return false;
	const players = getPlayers(code);
	const drawer = drawerOf(room, players);
	if (!drawer || drawer.id !== playerId) return false;
	db.prepare('DELETE FROM strokes WHERE room_code = ?').run(code);
	return true;
}

export function getState(code: string, playerId: number | null) {
	maybeTick(code);
	const room = roomByCode.get(code) as any;
	if (!room) return null;

	const players = getPlayers(code);
	const me = playerId != null ? players.find((p) => p.id === playerId) : null;
	const drawer = players[room.turn_index % players.length];
	const isDrawer = !!(me && room.state === 'playing' && drawer?.id === me.id);

	const strokes = db
		.prepare('SELECT color, size, path FROM strokes WHERE room_code = ? AND round = ? ORDER BY id')
		.all(code, room.round) as any[];
	const paths = strokes.map((s) => ({ color: s.color, size: s.size, path: JSON.parse(s.path) }));

	// word visible to the drawer; revealed to everyone once the turn is over
	const reveal = room.state === 'playing' && room.phase === 'wait';
	const showWord = isDrawer || reveal;

	const masked = !showWord && room.word
		? room.word
				.split('')
				.map((ch: string) => (ch === ' ' ? '  ' : '_'))
				.join('')
		: '';

	return {
		code: room.code,
		state: room.state,
		phase: room.phase,
		round: room.round,
		rounds: ROUNDS,
		turnIndex: room.turn_index,
		turnsTotal: players.length * ROUNDS,
		deadline: room.deadline,
		now: Date.now(),
		drawMs: room.draw_ms,
		guessMs: room.guess_ms,
		word: showWord ? room.word : null,
		maskedWord: showWord ? null : masked,
		isDrawer,
		strokes: paths,
		me: me
			? { id: me.id, name: me.name, score: me.score, guessed: !!me.guessed, isHost: !!me.is_host }
			: null,
		drawer: room.state === 'playing' ? { id: drawer?.id, name: drawer?.name } : null,
		players: players.map((p) => ({
			id: p.id,
			name: p.name,
			score: p.score,
			guessed: !!p.guessed,
			isHost: !!p.is_host
		}))
	};
}

export function touchPlayer(playerId: number) {
	db.prepare('UPDATE players SET last_seen = ? WHERE id = ?').run(Date.now(), playerId);
}
