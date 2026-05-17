import { modelContextService } from './model-context';
import {
	createForkliftSimulation,
	type ForkliftSimulationSnapshot
} from '$lib/domain/forklift-simulation';
import { createSimulationRunTracker } from './simulation-run-tracker';

export class ForkliftSceneController {
	private readonly simulation = createForkliftSimulation();
	private readonly runTracker = createSimulationRunTracker('forklift');
	private lastPhase: ForkliftSimulationSnapshot['phase'];
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

	moveForward(): void {
		this.simulation.moveForward();
		this.publishTelemetry(true);
	}

	moveBackward(): void {
		this.simulation.moveBackward();
		this.publishTelemetry(true);
	}

	turnLeft(): void {
		this.simulation.turnLeft();
		this.publishTelemetry(true);
	}

	turnRight(): void {
		this.simulation.turnRight();
		this.publishTelemetry(true);
	}

	raiseForks(): void {
		this.simulation.raiseForks();
		this.publishTelemetry(true);
	}

	lowerForks(): void {
		this.simulation.lowerForks();
		this.publishTelemetry(true);
	}

	get snapshot(): ForkliftSimulationSnapshot {
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

export function createForkliftSceneController(): ForkliftSceneController {
	return new ForkliftSceneController();
}
