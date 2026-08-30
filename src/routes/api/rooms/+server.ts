import { json } from '@sveltejs/kit';
import { createRoom } from '$lib/server/game';

export async function POST({ request }: { request: Request }) {
	const body = await request.json().catch(() => ({}));
	const name = String(body?.name ?? '').trim();
	if (!name) return json({ error: 'Name required' }, { status: 400 });
	const { code, playerId } = createRoom(name);
	return json({ code, playerId });
}
