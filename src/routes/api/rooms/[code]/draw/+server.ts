import { json } from '@sveltejs/kit';
import { addStroke, clearCanvas } from '$lib/server/game';

export async function POST({ params, request }: { params: { code: string }; request: Request }) {
	const body = await request.json().catch(() => ({}));
	const playerId = Number(body?.playerId);

	if (body?.clear) {
		const ok = clearCanvas(params.code, playerId);
		return ok ? json({ ok: true }) : json({ error: 'Not allowed' }, { status: 400 });
	}

	const stroke = body?.stroke;
	if (!stroke || !Array.isArray(stroke.path) || stroke.path.length === 0) {
		return json({ error: 'Bad stroke' }, { status: 400 });
	}
	// sanitize: clamp points to 0..1000, max 800 points
	const path = stroke.path
		.slice(0, 800)
		.map((p: number[]) => [
			Math.max(0, Math.min(1000, Math.round(Number(p?.[0]) || 0))),
			Math.max(0, Math.min(1000, Math.round(Number(p?.[1]) || 0)))
		]);
	const ok = addStroke(params.code, playerId, {
		color: /^#[0-9a-f]{6}$/i.test(String(stroke.color)) ? stroke.color : '#1e293b',
		size: Math.max(2, Math.min(30, Math.round(Number(stroke.size) || 6))),
		path
	});
	return ok ? json({ ok: true }) : json({ error: 'Not allowed' }, { status: 400 });
}
