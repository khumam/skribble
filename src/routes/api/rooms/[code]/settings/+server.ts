import { json } from '@sveltejs/kit';
import { updateSettings } from '$lib/server/game';

export async function POST({ params, request }: { params: { code: string }; request: Request }) {
	const body = await request.json().catch(() => ({}));
	const playerId = Number(body?.playerId);
	const ok = updateSettings(params.code, playerId, body?.drawSec, body?.guessSec);
	if (!ok) return json({ error: 'Cannot update settings' }, { status: 400 });
	return json({ ok: true });
}
