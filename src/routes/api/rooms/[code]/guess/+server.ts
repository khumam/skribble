import { json } from '@sveltejs/kit';
import { makeGuess } from '$lib/server/game';

export async function POST({ params, request }: { params: { code: string }; request: Request }) {
	const body = await request.json().catch(() => ({}));
	const playerId = Number(body?.playerId);
	const res = makeGuess(params.code, playerId, String(body?.guess ?? ''));
	if (!res.ok) return json({ error: res.error }, { status: 400 });
	return json({ correct: res.correct });
}
