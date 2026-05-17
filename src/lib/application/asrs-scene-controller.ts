import { modelContextService } from './model-context';
import {
	createAsrsSimulation,
	type AsrsSimulationSnapshot
} from '$lib/domain/asrs-simulation';
import { createSimulationRunTracker } from './simulation-run-tracker';

export class AsrsSceneController {
	private readonly simulation = createAsrsSimulation();
	private readonly runTracker = createSimulationRunTracker('asrs');
	private lastPhase: AsrsSimulationSnapshot['phase'];
	private elapsedSincePublish = 0;

	constructor() {
		this.runTracker.beginRun();
		this.lastPhase = this.simulation.getSnapshot().phase;
		this.publishTelemetry(true);
	}

	update(dt: number): void {
		const changed = this.simulation.update(dt);
		this.elapsedSincePublish += dt;

		const snapshot = this.simulation.getSnapshot();
		const phaseChanged = snapshot.phase !== this.lastPhase;

		if (changed && (phaseChanged || this.elapsedSincePublish >= 0.35)) {
			this.publishTelemetry();
		}

		this.runTracker.maybeRecordCompletion(snapshot);

		if (phaseChanged) {
			this.lastPhase = snapshot.phase;
		}
	}

	reset(): void {
		this.simulation.reset();
		this.runTracker.beginRun();
		this.lastPhase = this.simulation.getSnapshot().phase;
		this.publishTelemetry(true);
	}

	startAutoPilot(): void {
		this.simulation.startAutoPilot();
		this.publishTelemetry(true);
	}

	stopAutoPilot(): void {
		this.simulation.stopAutoPilot();
		this.publishTelemetry(true);
	}

	get snapshot(): AsrsSimulationSnapshot {
		return this.simulation.getSnapshot();
	}

	get summary(): string {
		return this.simulation.describe();
	}

	get telemetryModels() {
		return this.simulation.getTelemetryModels();
	}

	private publishTelemetry(force = false): void {
		const models = this.simulation.getTelemetryModels();

		if (!force && models.length === 0) {
			return;
		}

		modelContextService.publishTelemetryBatch(
			models,
			'demo',
			this.simulation.describe(),
			models[0] ?? null
		);
		this.elapsedSincePublish = 0;
	}
}

export function createAsrsSceneController(): AsrsSceneController {
	return new AsrsSceneController();
}
