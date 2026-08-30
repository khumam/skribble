<script lang="ts">
	import { goto } from '$app/navigation';

	let name = $state('');
	let code = $state('');
	let busy = $state(false);
	let error = $state('');

	function savePlayer(code: string, playerId: number, name: string) {
		localStorage.setItem('skribble', JSON.stringify({ code, playerId, name }));
	}

	async function createRoom() {
		if (!name.trim()) return (error = 'Enter your name first! 😄');
		busy = true;
		error = '';
		try {
			const r = await fetch('/api/rooms', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name })
			});
			const d = await r.json();
			if (!r.ok) throw new Error(d.error || 'Failed');
			savePlayer(d.code, d.playerId, name.trim());
			goto(`/room/${d.code}`);
		} catch (e: any) {
			error = e.message;
		} finally {
			busy = false;
		}
	}

	async function joinRoom() {
		const c = code.trim().toUpperCase();
		if (!name.trim()) return (error = 'Enter your name first! 😄');
		if (c.length !== 4) return (error = 'Room code is 4 characters');
		busy = true;
		error = '';
		try {
			const r = await fetch(`/api/rooms/${c}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ name })
			});
			const d = await r.json();
			if (!r.ok) throw new Error(d.error || 'Failed');
			savePlayer(c, d.playerId, name.trim());
			goto(`/room/${c}`);
		} catch (e: any) {
			error = e.message;
		} finally {
			busy = false;
		}
	}
</script>

<div class="app">
	<span class="px-star s1"></span>
	<span class="px-cloud c1"></span>
	<span class="px-star s2"></span>

	<h1 class="title">SKRIBBLE</h1>
	<p class="subtitle">DRAW · GUESS · WIN</p>

	<div class="card stack">
		<label class="lbl" for="name">your name</label>
		<input id="name" type="text" placeholder="Picasso Jr" maxlength="20" bind:value={name} />

		<button class="btn green" onclick={createRoom} disabled={busy}>✏️ CREATE ROOM</button>

		<div class="divider"><span class="pxdash">▪ ▪ ▪</span></div>

		<input
			type="text"
			placeholder="ROOM CODE"
			maxlength="4"
			class="code-input"
			bind:value={code}
			oninput={() => (code = code.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
		/>
		<button class="btn pink" onclick={joinRoom} disabled={busy}>🎲 JOIN ROOM</button>

		{#if error}<p class="error">⚠ {error}</p>{/if}
	</div>
</div>

<style>
	.app {
		padding-top: 24px;
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.lbl {
		font-family: var(--font-pixel);
		font-size: 10px;
		color: var(--ink-soft);
		margin-left: 4px;
	}

	.divider {
		text-align: center;
		margin: 2px 0;
	}
	.pxdash {
		font-size: 14px;
		color: var(--muted);
		letter-spacing: 6px;
	}

	.code-input {
		text-transform: uppercase;
		text-align: center;
		font-family: var(--font-pixel);
		font-size: 24px;
		letter-spacing: 8px;
	}

	.error {
		color: var(--coral-deep);
		text-align: center;
		margin: 0;
		font-weight: 600;
		font-size: 15px;
	}

	.s1 {
		top: 8%;
		right: 12%;
		transform: rotate(8deg);
	}
	.s2 {
		top: 46%;
		left: 4%;
		transform: rotate(-10deg) scale(0.8);
	}
	.c1 {
		top: 4%;
		left: 8%;
		transform: scale(0.8);
	}
</style>
