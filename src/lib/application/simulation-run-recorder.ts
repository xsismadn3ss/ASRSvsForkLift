import type { SimulationProcessRunInput } from '$lib/domain/simulation-process';

const SIMULATION_RUNS_ENDPOINT = '/api/simulation-runs';

export async function recordCompletedSimulationRun(
	run: SimulationProcessRunInput,
	endpoint = SIMULATION_RUNS_ENDPOINT
): Promise<void> {
	const response = await fetch(endpoint, {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: JSON.stringify(run)
	});

	if (response.ok) {
		return;
	}

	const details = await response.text();
	throw new Error(
		`No se pudo guardar la corrida completada (${response.status} ${response.statusText})${details ? `: ${details}` : ''}`
	);
}
