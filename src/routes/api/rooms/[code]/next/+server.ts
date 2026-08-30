import { json } from '@sveltejs/kit';
import { nextPlayer } from '$lib/server/game';

export async function POST({ params, request }: { params: { code: string }; request: Request }) {
	const body = await request.json().catch(() => ({}));
	const ok = await nextPlayer(params.code, Number(body?.playerId));
	if (!ok) return json({ error: 'Not allowed' }, { status: 400 });
	return json({ ok: true });
}
