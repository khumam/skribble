import { json } from '@sveltejs/kit';
import { getState, touchPlayer } from '$lib/server/game';

export async function GET({ params, url }: { params: { code: string }; url: URL }) {
	const playerId = Number(url.searchParams.get('playerId')) || null;
	if (playerId) touchPlayer(playerId);
	const state = getState(params.code, playerId);
	if (!state) return json({ error: 'Room not found' }, { status: 404 });
	return json(state);
}
