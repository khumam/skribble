import { json } from '@sveltejs/kit';
import { joinRoom, getState } from '$lib/server/game';

export async function POST({ params, request }: { params: { code: string }; request: Request }) {
	const body = await request.json().catch(() => ({}));
	const name = String(body?.name ?? '').trim();
	if (!name) return json({ error: 'Name required' }, { status: 400 });

	const joined = joinRoom(params.code, name);
	if (!joined) return json({ error: 'Room not found' }, { status: 404 });
	return json({ playerId: joined.playerId });
}

export async function GET({ params }: { params: { code: string } }) {
	const state = getState(params.code, null);
	if (!state) return json({ error: 'Room not found' }, { status: 404 });
	return json({ exists: true, players: state.players.length, state: state.state });
}
