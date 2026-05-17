import { error, json } from '@sveltejs/kit';

import {
	parseSimulationProcessRunInput
} from '$lib/domain/simulation-process';
import { simulationRunStore } from '$lib/server/simulation-run-store';

function parseLimit(value: string | null): number {
	if (!value) {
		return 120;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : 120;
}

export async function GET({ url }) {
	const runs = await simulationRunStore.listRecent(parseLimit(url.searchParams.get('limit')));
	return json({ runs });
}

export async function POST({ request }) {
	const rawBody = await request.text();

	let body: unknown;
	try {
		body = JSON.parse(rawBody);
	} catch {
		throw error(400, 'El cuerpo debe ser JSON válido.');
	}

	const payload = parseSimulationProcessRunInput(body);
	if (!payload) {
		throw error(400, 'La corrida enviada no tiene el formato esperado.');
	}

	const run = await simulationRunStore.record(payload);
	return json({ run }, { status: 201 });
}
