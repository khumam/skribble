// End-to-end game flow check. Usage: node scripts/check.mjs [baseUrl]
// Requires dev server running: npm run dev
import assert from 'node:assert';

const BASE = process.argv[2] || 'http://localhost:5173';
const api = async (path, opts) => {
	const r = await fetch(BASE + path, {
		...opts,
		headers: { 'content-type': 'application/json', ...(opts?.headers || {}) }
	});
	return { status: r.status, body: await r.json().catch(() => null) };
};
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = (code, id) => api(`/api/rooms/${code}/state?playerId=${id}`).then((r) => r.body);
// phases advance lazily on poll: poll until the wanted phase appears
async function awaitPhase(code, id, phase, timeout = 25000) {
	const t0 = Date.now();
	while (Date.now() - t0 < timeout) {
		const s = await state(code, id);
		if (s.phase === phase && s.state === 'playing') return s;
		await sleep(400);
	}
	throw new Error(`phase '${phase}' not reached in time`);
}

// 1. create + join
const { body: room } = await post('/api/rooms', { name: 'Ana' });
assert.ok(room.code?.length === 4, 'room code created');
const { body: join } = await post(`/api/rooms/${room.code}`, { name: 'Ben' });
assert.ok(join.playerId, 'Ben joined');

const p1 = room.playerId;
const p2 = join.playerId;
const code = room.code;

// 2. timer settings: host only, clamped 5..120
const notHost = await post(`/api/rooms/${code}/settings`, { playerId: p2, drawSec: 5, guessSec: 5 });
assert.equal(notHost.status, 400, 'non-host cannot set timers');
const setOk = await post(`/api/rooms/${code}/settings`, { playerId: p1, drawSec: 5, guessSec: 5 });
assert.equal(setOk.body.ok, true, 'host set 5s/5s timers');
const setClamp = await post(`/api/rooms/${code}/settings`, { playerId: p1, drawSec: 1, guessSec: 999 });
assert.equal(setClamp.body.ok, true, 'clamped timers accepted');
// reset to fast timers for the rest of the flow
await post(`/api/rooms/${code}/settings`, { playerId: p1, drawSec: 5, guessSec: 5 });

// 3. start
const started = await post(`/api/rooms/${code}/start`, { playerId: p1 });
assert.equal(started.body.ok, true, 'host started game');
let s1 = await state(code, p1);
let s2 = await state(code, p2);
assert.equal(s1.state, 'playing', 'game playing');
assert.equal(s1.phase, 'draw', 'starts in draw phase');
assert.ok(s1.drawMs >= 5000 && s1.guessMs >= 5000, 'timers clamped to min 5s');
assert.ok(s1.isDrawer, 'p1 draws first');
assert.ok(s1.word && !s2.word, 'word hidden from guesser');

// 4. no guessing during draw phase
const earlyGuess = await post(`/api/rooms/${code}/guess`, { playerId: p2, guess: s1.word });
assert.equal(earlyGuess.status, 400, 'cannot guess during draw phase');

// 5. drawing allowed in draw phase (drawer only)
const badStroke = await post(`/api/rooms/${code}/draw`, {
	playerId: p2,
	stroke: { color: '#ff0000', size: 5, path: [[1, 1], [2, 2]] }
});
assert.equal(badStroke.status, 400, 'guesser cannot draw');
const okStroke = await post(`/api/rooms/${code}/draw`, {
	playerId: p1,
	stroke: { color: '#ff0000', size: 5, path: [[1, 1], [500, 500]] }
});
assert.equal(okStroke.body.ok, true, 'drawer can draw');

// 6. draw phase -> guess phase on timeout
console.log('waiting for draw phase to end…');
s2 = await awaitPhase(code, p2, 'guess');
assert.equal(s2.strokes.length, 1, 'stroke visible to guesser');

// 7. no drawing during guess phase
const drawInGuess = await post(`/api/rooms/${code}/draw`, {
	playerId: p1,
	stroke: { color: '#ff0000', size: 5, path: [[10, 10], [20, 20]] }
});
assert.equal(drawInGuess.status, 400, 'cannot draw during guess phase');

// 8. wrong then correct guess
s1 = await state(code, p1);
const wrong = await post(`/api/rooms/${code}/guess`, { playerId: p2, guess: 'zzz' });
assert.equal(wrong.body.correct, false, 'wrong guess rejected');
const right = await post(`/api/rooms/${code}/guess`, { playerId: p2, guess: s1.word });
assert.equal(right.body.correct, true, 'correct guess accepted');
s1 = await state(code, p1);
assert.equal(s1.players.find((p) => p.id === p2).score, 1, 'guesser got +1');
assert.equal(s1.phase, 'wait', 'all guessed -> wait phase');
s2 = await state(code, p2);
assert.ok(s2.word, 'word revealed after turn ends');

// 9. next player: host or drawer only
const nextByOutsider = await post(`/api/rooms/${code}/next`, { playerId: p2 });
assert.equal(nextByOutsider.status, 400, 'non-host non-drawer cannot advance');
const next1 = await post(`/api/rooms/${code}/next`, { playerId: p1 });
assert.equal(next1.body.ok, true, 'host advanced');
s1 = await state(code, p1);
assert.equal(s1.turnIndex, 1, 'turn moved to player 2');
assert.equal(s1.phase, 'draw', 'new turn starts in draw phase');
assert.equal(s1.drawer.id, p2, 'p2 now draws');

// 10. guess phase timeout -> wait (nobody guesses)
console.log('waiting for turn 2 phases to time out…');
s1 = await awaitPhase(code, p1, 'wait');
assert.equal(s1.turnIndex, 1, 'still turn 2 in wait phase');
const next2 = await post(`/api/rooms/${code}/next`, { playerId: p2 }); // p2 is drawer
assert.equal(next2.body.ok, true, 'drawer advanced');
s1 = await state(code, p1);
assert.equal(s1.turnIndex, 2, 'turn 3');
assert.equal(s1.round, 2, 'round 2');

// 11. p1 draws (turn 3); p2 guesses right -> wait; advance
const drawerState = await state(code, p1); // p1 is the drawer now
await awaitPhase(code, p1, 'guess');
const right2 = await post(`/api/rooms/${code}/guess`, { playerId: p2, guess: drawerState.word });
assert.equal(right2.body.correct, true, 'p2 guessed turn 3 word');
s1 = await state(code, p1);
assert.equal(s1.players.find((p) => p.id === p2).score, 2, 'p2 at 2 points');
await post(`/api/rooms/${code}/next`, { playerId: p1 });
s1 = await state(code, p1);
assert.equal(s1.turnIndex, 3, 'turn 4');
assert.equal(s1.drawer.id, p2, 'p2 draws last turn');

// 12. last turn: timeout -> wait -> next ends game
console.log('waiting for last turn phases…');
s1 = await awaitPhase(code, p1, 'wait');
assert.equal(s1.turnIndex, 3, 'still turn 4 in wait phase');
const nextEnd = await post(`/api/rooms/${code}/next`, { playerId: p2 });
assert.equal(nextEnd.body.ok, true, 'final advance');
s1 = await state(code, p1);
assert.equal(s1.state, 'ended', 'game ended after all turns');

// 13. host restart
const again = await post(`/api/rooms/${code}/start`, { playerId: p1 });
assert.equal(again.body.ok, true, 'restart works');
s1 = await state(code, p1);
assert.equal(s1.state, 'playing', 'restarted playing');
assert.equal(s1.phase, 'draw', 'restarted in draw phase');
assert.equal(s1.players.every((p) => p.score === 0), true, 'scores reset');

console.log('✅ all flow checks passed');
