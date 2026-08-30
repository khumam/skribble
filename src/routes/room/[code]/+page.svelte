<script lang="ts">
	import { onMount } from 'svelte';

	let { data } = $props();
	const code = $derived(data.code.toUpperCase());

	type Player = { id: number; name: string; score: number; guessed: boolean; isHost: boolean };
	type Stroke = { color: string; size: number; path: number[][] };
	type GameState = {
		code: string;
		state: 'lobby' | 'playing' | 'ended';
		phase: 'draw' | 'guess' | 'wait';
		round: number;
		rounds: number;
		turnIndex: number;
		turnsTotal: number;
		deadline: number;
		now: number;
		drawMs: number;
		guessMs: number;
		word: string | null;
		maskedWord: string | null;
		isDrawer: boolean;
		strokes: Stroke[];
		me: Player | null;
		drawer: { id: number; name: string } | null;
		players: Player[];
	};

	let name = $state('');
	let me = $state<{ playerId: number; name: string } | null>(null);
	let joined = $state(false);
	let game = $state<GameState | null>(null);
	let roomError = $state('');
	let joinError = $state('');
	let guess = $state('');
	let feedback = $state('');
	let now = $state(Date.now());
	let modal = $state<{ correct: boolean; text: string } | null>(null);
	let drawSec = $state(10);
	let guessSec = $state(10);
	let settingsLoaded = $state(false);
	let settingsSaved = $state(false);

	// 8-bit palette for UI color swatches (name -> hex used on canvas)
	const COLORS = ['#4b3f73', '#ef6da8', '#5a9df2', '#35bd82', '#f2a83b', '#f0704a', '#9b6bd8', '#ffffff'];
	const SIZES = [4, 8, 16];
	let color = $state(COLORS[0]);
	let brush = $state(SIZES[1]);

	// canvas
	let canvas: HTMLCanvasElement = $state(null!);
	let drawing = false;
	let buffer: number[][] = [];
	let flushTimer: ReturnType<typeof setTimeout> | null = null;
	const roomState = $derived(game?.state ?? 'lobby');
	const stage = $derived(game?.phase ?? 'wait');
	const meP = $derived(game?.me ?? null);
	const players = $derived(game?.players ?? []);
	const sorted = $derived([...players].sort((a, b) => b.score - a.score));
	const drawer = $derived(game?.drawer ?? null);
	const word = $derived(game?.word ?? null);
	const maskedWord = $derived(game?.maskedWord ?? null);
	const round = $derived(game?.round ?? 1);
	const rounds = $derived(game?.rounds ?? 1);
	const iDraw = $derived(!!game?.isDrawer);
	const phaseMs = $derived(
		stage === 'draw' ? (game?.drawMs ?? 10000) : stage === 'guess' ? (game?.guessMs ?? 10000) : 0
	);
	const remaining = $derived(
		roomState === 'playing' && stage !== 'wait' ? Math.max(0, (game?.deadline ?? 0) - now) : 0
	);
	const secondsLeft = $derived(Math.ceil(remaining / 1000));
	const canDraw = $derived(roomState === 'playing' && stage === 'draw' && iDraw && remaining > 0);
	const canGuess = $derived(roomState === 'playing' && stage === 'guess' && !!meP && !iDraw && !meP.guessed);
	const canAdvance = $derived(
		roomState === 'playing' && stage === 'wait' && !!meP && (!!meP.isHost || iDraw)
	);

	// load timer settings once from the room
	$effect(() => {
		if (!settingsLoaded && game) {
			drawSec = Math.round((game.drawMs ?? 10000) / 1000);
			guessSec = Math.round((game.guessMs ?? 10000) / 1000);
			settingsLoaded = true;
		}
	});

	onMount(() => {
		const raw = localStorage.getItem('skribble');
		if (raw) {
			try {
				const p = JSON.parse(raw);
				if (p.code === code && p.playerId) {
					me = { playerId: p.playerId, name: p.name };
					joined = true;
					if (p.name) name = p.name;
				} else if (p.name) {
					name = p.name;
				}
			} catch {}
		}
		const t = setInterval(() => (now = Date.now()), 200);
		return () => clearInterval(t);
	});

	// poll while joined
	$effect(() => {
		if (!joined) return;
		let alive = true;
		const poll = async () => {
			if (!alive) return;
			try {
				const r = await fetch(`/api/rooms/${code}/state?playerId=${me!.playerId}`);
				if (r.status === 404) {
					roomError = 'Room not found 😢';
					game = null;
					return;
				}
				game = await r.json();
				roomError = '';
				render(game?.strokes ?? []);
			} catch {}
			if (alive) setTimeout(poll, 700);
		};
		poll();
		return () => {
			alive = false;
		};
	});

	async function join() {
		if (!name.trim()) return (joinError = 'Enter your name!');
		joinError = '';
		const r = await fetch(`/api/rooms/${code}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name })
		});
		const d = await r.json();
		if (!r.ok) return (joinError = d.error || 'Could not join');
		me = { playerId: d.playerId, name: name.trim() };
		joined = true;
		localStorage.setItem('skribble', JSON.stringify({ code, playerId: d.playerId, name: name.trim() }));
	}

	async function start() {
		await fetch(`/api/rooms/${code}/start`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ playerId: me!.playerId })
		});
	}

	async function submitGuess(e: SubmitEvent) {
		e.preventDefault();
		if (!guess.trim() || !me) return;
		const text = guess.trim();
		guess = '';
		const r = await fetch(`/api/rooms/${code}/guess`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ playerId: me.playerId, guess: text })
		});
		if (!r.ok) return;
		const d = await r.json();
		modal = { correct: !!d.correct, text };
		setTimeout(() => (modal = null), d.correct ? 2200 : 1300);
	}

	async function next() {
		await fetch(`/api/rooms/${code}/next`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ playerId: me!.playerId })
		});
	}

	async function saveSettings() {
		const r = await fetch(`/api/rooms/${code}/settings`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ playerId: me!.playerId, drawSec, guessSec })
		});
		if (r.ok) {
			settingsSaved = true;
			setTimeout(() => (settingsSaved = false), 1500);
		}
	}

	async function share() {
		const url = location.href;
		if (navigator.share) {
			try {
				await navigator.share({ title: 'Skribble!', text: `Join my room ${code}`, url });
			} catch {}
		} else {
			await navigator.clipboard.writeText(`${code}`).catch(() => {});
			feedback = 'Code copied! 📋';
			setTimeout(() => (feedback = ''), 2000);
		}
	}

	// ---------- canvas ----------
	function toXY(e: PointerEvent): number[] {
		const r = canvas.getBoundingClientRect();
		return [
			Math.round(((e.clientX - r.left) / r.width) * 1000),
			Math.round(((e.clientY - r.top) / r.height) * 1000)
		];
	}

	function ctx2d() {
		const c = canvas.getContext('2d')!;
		c.fillStyle = '#ffffff';
		c.fillRect(0, 0, canvas.width, canvas.height);
		return c;
	}

	function drawPath(c: CanvasRenderingContext2D, s: Stroke) {
		if (s.path.length < 2) return;
		const k = canvas.width / 1000;
		c.strokeStyle = s.color;
		c.lineWidth = s.size * k;
		c.lineCap = 'round';
		c.lineJoin = 'round';
		c.beginPath();
		c.moveTo(s.path[0][0] * k, s.path[0][1] * k);
		for (let i = 1; i < s.path.length; i++) c.lineTo(s.path[i][0] * k, s.path[i][1] * k);
		c.stroke();
	}

	function render(strokes: Stroke[]) {
		if (!canvas) return;
		const dpr = window.devicePixelRatio || 1;
		const w = Math.round(canvas.clientWidth * dpr);
		const h = Math.round(canvas.clientHeight * dpr);
		if (canvas.width !== w || canvas.height !== h) {
			canvas.width = w;
			canvas.height = h;
		}
		const c = ctx2d();
		for (const s of strokes) drawPath(c, s);
	}

	// redraw on resize + on new strokes
	$effect(() => {
		if (game?.strokes) render(game.strokes);
	});

	function onDown(e: PointerEvent) {
		if (!canDraw) return;
		drawing = true;
		canvas.setPointerCapture(e.pointerId);
		buffer = [toXY(e)];
	}

	function onMove(e: PointerEvent) {
		if (!drawing) return;
		const p = toXY(e);
		const prev = buffer[buffer.length - 1];
		buffer.push(p);
		// local echo
		drawPath(ctx2d(), { color, size: brush, path: [prev, p] });
		if (!flushTimer) flushTimer = setTimeout(flush, 250);
	}

	function onUp() {
		if (!drawing) return;
		drawing = false;
		flush();
	}

	async function flush() {
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
		if (buffer.length < 2 || !me) return;
		// include overlap point so segments connect
		const pts = buffer;
		buffer = [pts[pts.length - 1]];
		try {
			await fetch(`/api/rooms/${code}/draw`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					playerId: me.playerId,
					stroke: { color, size: brush, path: pts }
				})
			});
		} catch {}
	}

	async function clearBoard() {
		await fetch(`/api/rooms/${code}/draw`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ playerId: me!.playerId, clear: true })
		});
		render([]);
	}
</script>

<div class="app">
	{#if !roomError && game}
		<span class="px-star s1"></span>
		<span class="px-star s2"></span>
	{/if}
	{#if roomError}
		<div class="card center">
			<p style="font-size:40px">😢</p>
			<h2>{roomError}</h2>
			<a class="btn" href="/">🏠 Home</a>
		</div>
	{:else if !joined}
		<div class="card stack">
			<h2 class="ph" style="margin:0;text-align:center">JOIN ROOM</h2>
			<p class="hint">room code: <span class="code">{code}</span></p>
			<input type="text" placeholder="Your name" maxlength="20" bind:value={name} />
			<button class="btn green" onclick={join}>🎉 LET ME IN</button>
			{#if joinError}<p class="err">{joinError}</p>{/if}
			<a href="/" style="text-align:center;color:var(--violet-deep)">← back</a>
		</div>
	{:else if game}
		<!-- header -->
		<div class="topbar">
			<a class="home" href="/" aria-label="Home">🏠</a>
			<button class="codepill" onclick={share}>#{code} 🔗</button>
			{#if roomState === 'playing'}
				<span class="roundpill">R{round}/{rounds}</span>
			{/if}
		</div>

		{#if roomState === 'lobby'}
			<div class="card stack" style="margin-top:12px">
				<h2 class="ph" style="margin:0;text-align:center">WAITING ROOM</h2>
				<p class="hint">Share code <b>{code}</b> with friends. Need at least 2 players.</p>
				<ul class="plist">
					{#each players as p (p.id)}
						<li class:you={p.id === meP?.id}>
							{#if p.isHost}👑{/if} {p.name}
						</li>
					{/each}
				</ul>

				{#if meP?.isHost}
					<div class="settings">
						<div class="setrow">
							<label for="draw-sec">draw time</label>
							<div class="setcontrol">
								<button class="step" onclick={() => (drawSec = Math.max(5, drawSec - 1))} aria-label="decrease draw time">−</button>
								<input id="draw-sec" type="number" min="5" max="120" bind:value={drawSec} />
								<button class="step" onclick={() => (drawSec = Math.min(120, drawSec + 1))} aria-label="increase draw time">+</button>
							</div>
							<span class="unit">sec</span>
						</div>
						<div class="setrow">
							<label for="guess-sec">guess time</label>
							<div class="setcontrol">
								<button class="step" onclick={() => (guessSec = Math.max(5, guessSec - 1))} aria-label="decrease guess time">−</button>
								<input id="guess-sec" type="number" min="5" max="120" bind:value={guessSec} />
								<button class="step" onclick={() => (guessSec = Math.min(120, guessSec + 1))} aria-label="increase guess time">+</button>
							</div>
							<span class="unit">sec</span>
						</div>
						<button class="btn small" onclick={saveSettings}>💾 SAVE TIME</button>
						{#if settingsSaved}<p class="saved">saved ✓</p>{/if}
					</div>

					<button class="btn green" onclick={start} disabled={players.length < 2}>
						▶️ START {players.length < 2 ? `(${2 - players.length} MORE)` : ''}
					</button>
				{:else}
					<p class="hint" style="text-align:center">Waiting for host to start… ⏳</p>
				{/if}
			</div>

		{:else if roomState === 'ended'}
			<div class="card stack" style="margin-top:12px">
				<h2 class="ph" style="margin:0;text-align:center;font-size:22px">GAME OVER</h2>
				<ul class="scores">
					{#each sorted as p, i (p.id)}
						<li class:you={p.id === meP?.id}>
							<span class="rank">{#if i === 0}🥇{:else if i === 1}🥈{:else if i === 2}🥉{:else}{i + 1}{/if}</span>
							<span class="pname">{p.name}</span>
							<span class="pts">{p.score}</span>
						</li>
					{/each}
				</ul>
				{#if meP?.isHost}
					<div class="settings">
						<div class="setrow">
							<label for="draw-sec2">draw time</label>
							<div class="setcontrol">
								<button class="step" onclick={() => (drawSec = Math.max(5, drawSec - 1))} aria-label="decrease draw time">−</button>
								<input id="draw-sec2" type="number" min="5" max="120" bind:value={drawSec} />
								<button class="step" onclick={() => (drawSec = Math.min(120, drawSec + 1))} aria-label="increase draw time">+</button>
							</div>
							<span class="unit">sec</span>
						</div>
						<div class="setrow">
							<label for="guess-sec2">guess time</label>
							<div class="setcontrol">
								<button class="step" onclick={() => (guessSec = Math.max(5, guessSec - 1))} aria-label="decrease guess time">−</button>
								<input id="guess-sec2" type="number" min="5" max="120" bind:value={guessSec} />
								<button class="step" onclick={() => (guessSec = Math.min(120, guessSec + 1))} aria-label="increase guess time">+</button>
							</div>
							<span class="unit">sec</span>
						</div>
						<button class="btn small" onclick={saveSettings}>💾 SAVE TIME</button>
						{#if settingsSaved}<p class="saved">saved ✓</p>{/if}
					</div>
					<button class="btn green" onclick={start}>🔁 PLAY AGAIN</button>
				{:else}
					<p class="hint" style="text-align:center">Host can restart the game ⏳</p>
				{/if}
			</div>

		{:else}
			<!-- phase banner -->
			<div class="wordbar card">
				{#if stage === 'draw'}
					{#if iDraw}
						<span class="wlabel">🎨 you draw</span>
						<span class="word">{word}</span>
					{:else}
						<span class="wlabel">✏️ {drawer?.name ?? ''} is drawing</span>
						<span class="word masked">{maskedWord}</span>
					{/if}
				{:else if stage === 'guess'}
					{#if iDraw}
						<span class="wlabel">👀 waiting for guesses</span>
						<span class="word">{word}</span>
					{:else}
						<span class="wlabel">🔎 guess {drawer?.name ?? ''}'s drawing</span>
						<span class="word masked">{maskedWord}</span>
					{/if}
				{:else}
					<span class="wlabel">☁️ {drawer?.name ?? ''}'s turn done</span>
					<span class="word reveal">{word}</span>
				{/if}
				{#if stage !== 'wait'}
					<span class="timer" class:urgent={secondsLeft <= 3}>⏱ {secondsLeft}s</span>
				{/if}
			</div>

			{#if stage !== 'wait'}
				<div class="timerbar" style="width:{(remaining / phaseMs) * 100}%"></div>
			{/if}

			<!-- board -->
			<canvas
				bind:this={canvas}
				class="board"
				class:drawable={canDraw}
				onpointerdown={onDown}
				onpointermove={onMove}
				onpointerup={onUp}
				onpointercancel={onUp}
			></canvas>

			<!-- draw tools -->
			{#if canDraw}
				<div class="tools card">
					<div class="swatches">
						{#each COLORS as c (c)}
							<button
								class="swatch"
								class:sel={color === c}
								class:eraser={c === '#ffffff'}
								style="background:{c}"
								aria-label="color {c}"
								onclick={() => (color = c)}
							></button>
						{/each}
					</div>
					<div class="sizes">
						{#each SIZES as s (s)}
							<button class="sizebtn" class:sel={brush === s} onclick={() => (brush = s)} aria-label="brush size {s}">
								<span style="width:{s + 4}px;height:{s + 4}px"></span>
							</button>
						{/each}
						<button class="clearbtn" onclick={clearBoard} aria-label="clear canvas">🗑</button>
					</div>
				</div>
			{/if}

			<!-- guess box -->
			{#if canGuess}
				<form class="guessrow" onsubmit={submitGuess}>
					<input type="text" placeholder="Type your guess…" autocomplete="off" bind:value={guess} />
					<button class="btn pink" type="submit" aria-label="send guess">SEND</button>
				</form>
			{:else if iDraw && stage === 'draw'}
				<div class="guessed card">🖌 it's your canvas — draw!</div>
			{:else if !iDraw && stage === 'draw' && meP}
				<div class="guessed card">👀 {drawer?.name ?? ''} is drawing…</div>
			{:else if stage === 'guess' && iDraw}
				<div class="guessed card">👀 others are guessing…</div>
			{:else if stage === 'guess' && meP && meP.guessed}
				<div class="guessed card">✅ you got it! waiting…</div>
			{/if}

			{#if feedback}<div class="toast card">{feedback}</div>{/if}

			<!-- next player -->
			{#if canAdvance}
				<button class="btn green nextbtn" onclick={next}>▶️ NEXT PLAYER</button>
			{:else if stage === 'wait' && meP}
				<p class="hint" style="margin:10px 0 0">
					{drawer?.name ?? 'Drawer'} or the host can continue…
				</p>
			{/if}

			<!-- players -->
			<div class="card" style="margin-top:12px">
				<ul class="scores">
					{#each players as p (p.id)}
						<li class:you={p.id === meP?.id}>
							<span class="pname">
								{#if p.id === drawer?.id}✏️{/if}{p.name}{#if p.guessed}&nbsp;✅{/if}</span>
							<span class="pts">{p.score}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	{:else}
		<div class="card center"><p>Loading… ⏳</p></div>
	{/if}

	{#if modal}
		<div class="modal-backdrop" role="dialog" aria-modal="true">
			<div class="modal card {modal.correct ? 'win' : 'lose'}" class:pop={true}>
				<span class="big">{modal.correct ? '🎉' : '😅'}</span>
				<h2 class="ph">{modal.correct ? 'CORRECT!' : 'NOPE'}</h2>
				{#if modal.correct}
					<p>+1 point! “{modal.text}” was the word!</p>
				{:else}
					<p>“{modal.text}” is not the word. keep guessing!</p>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.ph {
		font-family: var(--font-pixel);
		font-size: 16px;
		letter-spacing: 1px;
		color: var(--ink);
		text-shadow: 0 2px 0 var(--pink);
	}
	.s1 {
		top: 6%;
		right: 8%;
		transform: rotate(10deg);
	}
	.s2 {
		top: 12%;
		left: 2%;
		transform: rotate(-8deg) scale(0.75);
	}
	.stack {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.center {
		text-align: center;
		margin-top: 40px;
	}
	.hint {
		color: var(--ink-soft);
		margin: 0;
		text-align: center;
	}
	.err {
		color: var(--coral-deep);
		text-align: center;
		margin: 0;
		font-weight: 600;
	}
	.code {
		color: var(--violet-deep);
		font-weight: 700;
	}

	/* ---------- topbar ---------- */
	.topbar {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.home {
		width: 44px;
		height: 44px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 20px;
		text-decoration: none;
		border: var(--line);
		border-radius: 14px;
		background: var(--clay);
		box-shadow:
			inset 0 3px 0 rgba(255, 255, 255, 0.9),
			0 4px 0 var(--clay-shade),
			0 8px 0 rgba(75, 63, 115, 0.12);
	}
	.home:active {
		transform: translateY(4px);
		box-shadow: inset 0 3px 0 rgba(255, 255, 255, 0.9), 0 1px 0 rgba(75, 63, 115, 0.1);
	}
	.codepill {
		font-family: var(--font-pixel);
		font-size: 14px;
		letter-spacing: 2px;
		border: var(--line);
		border-radius: 14px;
		padding: 12px 16px;
		background: var(--butter);
		color: var(--ink);
		text-shadow: 0 1px 0 rgba(255, 255, 255, 0.5);
		box-shadow:
			inset 0 3px 0 rgba(255, 255, 255, 0.55),
			0 4px 0 var(--butter-deep),
			0 8px 0 rgba(75, 63, 115, 0.12);
		transition: transform 0.15s var(--bounce), box-shadow 0.15s var(--bounce);
	}
	.codepill:active {
		transform: translateY(4px);
		box-shadow:
			inset 0 3px 0 rgba(255, 255, 255, 0.55),
			0 1px 0 rgba(75, 63, 115, 0.1);
	}
	.roundpill {
		font-family: var(--font-pixel);
		font-size: 11px;
		color: var(--ink);
		background: var(--sky);
		border: var(--line);
		padding: 12px 14px;
		border-radius: 14px;
		box-shadow:
			inset 0 3px 0 rgba(255, 255, 255, 0.5),
			0 4px 0 var(--sky-deep);
	}

	/* ---------- lobby ---------- */
	.plist {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		justify-content: center;
	}
	.plist li {
		border: 3px solid var(--ink);
		border-radius: 16px;
		padding: 8px 14px;
		font-weight: 600;
		background: var(--sky);
		box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.55), 0 3px 0 var(--sky-deep);
	}
	.plist li:nth-child(3n + 2) {
		background: var(--pink);
		box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.55), 0 3px 0 var(--pink-deep);
	}
	.plist li:nth-child(3n) {
		background: var(--mint);
		box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.55), 0 3px 0 var(--mint-deep);
	}
	.plist li.you {
		outline: 3px dashed var(--ink);
		outline-offset: 2px;
	}

	/* ---------- word bar ---------- */
	.wordbar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 16px;
		border-radius: var(--radius);
		margin-top: 12px;
		flex-wrap: wrap;
	}
	.wlabel {
		font-size: 14px;
		font-weight: 600;
		color: var(--ink-soft);
	}
	.word {
		font-family: var(--font-pixel);
		font-size: 18px;
		line-height: 1.4;
		color: var(--ink);
		flex: 1;
		text-transform: uppercase;
	}
	.word.masked {
		color: var(--violet-deep);
	}
	.word.reveal {
		color: var(--coral-deep);
	}
	.timer {
		font-family: var(--font-pixel);
		font-size: 16px;
		color: var(--mint-deep);
		text-shadow: 0 2px 0 rgba(255, 255, 255, 0.6);
	}
	.timer.urgent {
		color: var(--coral-deep);
		animation: blink 0.4s steps(2, jump-none) infinite;
	}
	@keyframes blink {
		50% {
			opacity: 0.3;
		}
	}
	.timerbar {
		height: 14px;
		border: var(--line);
		border-radius: 8px;
		margin-top: 8px;
		background:
			repeating-linear-gradient(90deg, var(--mint) 0 10px, var(--clay) 10px 14px);
		box-shadow: inset 0 2px 4px rgba(75, 63, 115, 0.2);
		transition: width 0.2s linear;
	}

	/* ---------- board ---------- */
	.board {
		width: 100%;
		aspect-ratio: 4 / 3;
		background: #ffffff;
		border: var(--line);
		border-radius: var(--radius);
		margin-top: 10px;
		box-shadow:
			inset 0 6px 10px rgba(75, 63, 115, 0.08),
			0 6px 0 var(--clay-shade),
			0 14px 24px rgba(75, 63, 115, 0.14);
		touch-action: none;
	}
	.board.drawable {
		cursor: crosshair;
	}

	/* ---------- tools ---------- */
	.tools {
		margin-top: 10px;
		padding: 12px 14px;
		border-radius: var(--radius);
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		flex-wrap: wrap;
	}
	.swatches {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	.swatch {
		width: 34px;
		height: 34px;
		border: var(--line);
		border-radius: 10px;
		padding: 0;
		box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.45), 0 3px 0 rgba(75, 63, 115, 0.25);
		transition: transform 0.12s var(--bounce);
	}
	.swatch.eraser {
		border-style: dashed;
	}
	.swatch.sel {
		transform: translateY(-3px);
		outline: 3px dashed var(--ink);
		outline-offset: 2px;
	}
	.sizes {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.sizebtn {
		width: 40px;
		height: 40px;
		border: var(--line);
		border-radius: 10px;
		background: var(--clay);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0;
		box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.9), 0 3px 0 var(--clay-shade);
	}
	.sizebtn span {
		border-radius: 4px;
		background: var(--ink);
		display: block;
	}
	.sizebtn.sel {
		background: var(--butter);
		box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.6), 0 3px 0 var(--butter-deep);
	}
	.clearbtn {
		border: var(--line);
		border-radius: 10px;
		background: var(--coral);
		font-size: 17px;
		width: 40px;
		height: 40px;
		box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.55), 0 3px 0 var(--coral-deep);
	}
	.clearbtn:active {
		transform: translateY(3px);
		box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.55);
	}

	/* ---------- guess ---------- */
	.guessrow {
		display: flex;
		gap: 8px;
		margin-top: 10px;
	}
	.guessrow input {
		flex: 1;
	}
	.guessrow .btn {
		font-family: var(--font-pixel);
		font-size: 12px;
		padding: 10px 18px;
		border-radius: 14px;
	}
	.guessed {
		margin-top: 10px;
		text-align: center;
		font-weight: 700;
		color: var(--mint-deep);
		padding: 12px;
		border-radius: 16px;
	}
	.toast {
		margin-top: 10px;
		text-align: center;
		padding: 10px;
		border-radius: 16px;
		font-weight: 700;
		animation: pop 0.25s var(--bounce);
	}
	@keyframes pop {
		from {
			transform: scale(0.85);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}

	/* ---------- settings ---------- */
	.settings {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px;
		border: 3px dashed var(--violet-deep);
		border-radius: var(--radius);
	}
	.setrow {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.setrow label {
		flex: 1;
		font-weight: 700;
		font-size: 15px;
		color: var(--ink-soft);
	}
	.setcontrol {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.step {
		width: 40px;
		height: 40px;
		font-size: 20px;
		font-weight: 700;
		border: var(--line);
		border-radius: 10px;
		background: var(--violet);
		box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.55), 0 3px 0 var(--violet-deep);
	}
	.step:active {
		transform: translateY(3px);
		box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.55);
	}
	.setcontrol input {
		width: 64px;
		text-align: center;
		font-family: var(--font-pixel);
		font-size: 16px;
		border-radius: 10px;
		padding: 10px 4px;
	}
	.setrow .unit {
		font-family: var(--font-pixel);
		font-size: 9px;
		color: var(--muted);
		width: 30px;
	}
	.saved {
		margin: 0;
		text-align: center;
		color: var(--mint-deep);
		font-weight: 700;
	}

	/* ---------- next player ---------- */
	.nextbtn {
		margin-top: 12px;
		width: 100%;
		font-size: 16px;
	}

	/* ---------- modal ---------- */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		background: rgba(75, 63, 115, 0.4);
	}
	.modal {
		text-align: center;
		max-width: 320px;
		animation: pop 0.25s var(--bounce);
	}
	.modal.win {
		background: var(--mint);
		box-shadow:
			inset 0 4px 0 rgba(255, 255, 255, 0.9),
			inset 0 -10px 12px rgba(157, 130, 217, 0.16),
			0 6px 0 var(--mint-deep),
			0 14px 24px rgba(75, 63, 115, 0.18);
	}
	.modal.lose {
		background: var(--clay);
	}
	.modal .big {
		font-size: 52px;
		display: block;
		margin-bottom: 8px;
	}
	.modal p {
		margin: 8px 0 4px;
		font-weight: 600;
		color: var(--ink-soft);
	}

	/* ---------- scores ---------- */
	.scores {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.scores li {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 4px;
		border-bottom: 3px dashed var(--clay-shade);
		font-size: 17px;
		font-weight: 600;
	}
	.scores li:last-child {
		border-bottom: none;
	}
	.scores li.you {
		color: var(--violet-deep);
		font-weight: 700;
	}
	.rank {
		width: 30px;
		text-align: center;
	}
	.pname {
		flex: 1;
	}
	.pts {
		font-family: var(--font-pixel);
		font-size: 13px;
		background: var(--violet);
		border: 3px solid var(--ink);
		border-radius: 10px;
		padding: 6px 10px;
		box-shadow: inset 0 2px 0 rgba(255, 255, 255, 0.55), 0 3px 0 var(--violet-deep);
	}
</style>
