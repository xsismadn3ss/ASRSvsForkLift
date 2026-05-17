import type { SimulationCompletionSnapshot, SimulationProcessType } from '$lib/domain/simulation-process';
import type { SimulationProcessRunInput } from '$lib/domain/simulation-process';

import { recordCompletedSimulationRun } from './simulation-run-recorder';

function createRunId(): string {
	return globalThis.crypto?.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function nowIso(): string {
	return new Date().toISOString();
}

export class SimulationRunTracker {
	private runId = createRunId();
	private startedAt = nowIso();
	private completionRecorded = false;
	private submissionRunId: string | null = null;

	constructor(private readonly processType: SimulationProcessType) {}

	beginRun(): void {
		this.runId = createRunId();
		this.startedAt = nowIso();
		this.completionRecorded = false;
		this.submissionRunId = null;
	}

	maybeRecordCompletion(snapshot: SimulationCompletionSnapshot): void {
		if (!snapshot.completed || this.completionRecorded || this.submissionRunId === this.runId) {
			return;
		}

		const runId = this.runId;
		this.submissionRunId = runId;

		const payload: SimulationProcessRunInput = {
			id: runId,
			processType: this.processType,
			startedAt: this.startedAt,
			completedAt: nowIso(),
			completedPhase: snapshot.phase,
			message: snapshot.message,
			loadsCompleted: snapshot.deliveredLoads.length
		};

		void recordCompletedSimulationRun(payload)
			.then(() => {
				if (this.runId === runId) {
					this.completionRecorded = true;
				}
			})
			.catch((error) => {
				console.error(`[simulation-run][${this.processType}]`, error);
			})
			.finally(() => {
				if (this.submissionRunId === runId) {
					this.submissionRunId = null;
				}
			});
	}
}

export function createSimulationRunTracker(processType: SimulationProcessType): SimulationRunTracker {
	return new SimulationRunTracker(processType);
}
