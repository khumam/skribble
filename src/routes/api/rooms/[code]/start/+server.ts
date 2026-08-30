import { json } from '@sveltejs/kit';
import { startGame } from '$lib/server/game';

export async function POST({ params, request }: { params: { code: string }; request: Request }) {
	const body = await request.json().catch(() => ({}));
	const playerId = Number(body?.playerId);
	const ok = await startGame(params.code, playerId);
	if (!ok) return json({ error: 'Cannot start' }, { status: 400 });
	return json({ ok: true });
}
