export type SimulationProcessType = 'asrs' | 'forklift';

export type SimulationCompletionSnapshot = Readonly<{
	phase: string;
	message: string;
	completed: boolean;
	deliveredLoads: readonly unknown[];
}>;

export type SimulationProcessRunInput = Readonly<{
	id: string;
	processType: SimulationProcessType;
	startedAt: string;
	completedAt: string;
	completedPhase: string;
	message: string;
	loadsCompleted: number;
}>;

export type SimulationProcessRun = SimulationProcessRunInput &
	Readonly<{
		durationMs: number;
	}>;

export type SimulationProcessSummary = Readonly<{
	totalRuns: number;
	averageDurationMs: number;
	fastestDurationMs: number | null;
	slowestDurationMs: number | null;
	byProcessType: Readonly<
		Record<
			SimulationProcessType,
			Readonly<{
				count: number;
				averageDurationMs: number;
				fastestDurationMs: number | null;
				slowestDurationMs: number | null;
			}>
		>
	>;
}>;

const PROCESS_LABELS: Readonly<Record<SimulationProcessType, string>> = Object.freeze({
	asrs: 'ASRS',
	forklift: 'Forklift'
});

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | null {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	return null;
}

function toInteger(value: unknown): number | null {
	if (typeof value === 'number' && Number.isInteger(value)) {
		return value;
	}

	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number(value);
		return Number.isInteger(parsed) ? parsed : null;
	}

	return null;
}

function parseTimestamp(value: unknown): string | null {
	const text = toText(value);
	if (!text) {
		return null;
	}

	const parsed = new Date(text);
	return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function normalizeSimulationProcessType(value: unknown): SimulationProcessType | null {
	return value === 'asrs' || value === 'forklift' ? value : null;
}

export function formatSimulationProcessLabel(value: SimulationProcessType): string {
	return PROCESS_LABELS[value];
}

export function formatDurationMs(value: number): string {
	if (!Number.isFinite(value) || value < 0) {
		return '0 ms';
	}

	if (value < 1000) {
		return `${Math.round(value)} ms`;
	}

	const totalSeconds = value / 1000;

	if (totalSeconds < 60) {
		return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)} s`;
	}

	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds - minutes * 60;
	return `${minutes}m ${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
}

export function createSimulationProcessRun(input: SimulationProcessRunInput): SimulationProcessRun {
	const startedAt = new Date(input.startedAt);
	const completedAt = new Date(input.completedAt);
	const durationMs = completedAt.getTime() - startedAt.getTime();

	return {
		...input,
		durationMs: durationMs >= 0 ? durationMs : 0
	};
}

export function parseSimulationProcessRunInput(
	input: unknown
): SimulationProcessRunInput | null {
	if (!isRecord(input)) {
		return null;
	}

	const id = toText(input.id);
	const processType = normalizeSimulationProcessType(input.processType);
	const startedAt = parseTimestamp(input.startedAt);
	const completedAt = parseTimestamp(input.completedAt);
	const completedPhase = toText(input.completedPhase);
	const message = toText(input.message);
	const loadsCompleted = toInteger(input.loadsCompleted);

	if (
		!id ||
		!processType ||
		!startedAt ||
		!completedAt ||
		!completedPhase ||
		!message ||
		loadsCompleted === null ||
		loadsCompleted < 0
	) {
		return null;
	}

	if (new Date(completedAt).getTime() < new Date(startedAt).getTime()) {
		return null;
	}

	return {
		id,
		processType,
		startedAt,
		completedAt,
		completedPhase,
		message,
		loadsCompleted
	};
}

export function calculateSimulationProcessSummary(
	runs: readonly SimulationProcessRun[]
): SimulationProcessSummary {
	const stats = runs.reduce(
		(accumulator, run) => {
			const bucket = accumulator.byProcessType[run.processType];
			const nextBucketDuration = bucket.averageDurationMs * bucket.count + run.durationMs;
			const nextBucketCount = bucket.count + 1;
			accumulator.totalDurationMs += run.durationMs;
			accumulator.totalRuns += 1;
			accumulator.fastestDurationMs =
				accumulator.fastestDurationMs === null
					? run.durationMs
					: Math.min(accumulator.fastestDurationMs, run.durationMs);
			accumulator.slowestDurationMs =
				accumulator.slowestDurationMs === null
					? run.durationMs
					: Math.max(accumulator.slowestDurationMs, run.durationMs);
			bucket.count = nextBucketCount;
			bucket.averageDurationMs = nextBucketDuration / nextBucketCount;
			bucket.fastestDurationMs =
				bucket.fastestDurationMs === null
					? run.durationMs
					: Math.min(bucket.fastestDurationMs, run.durationMs);
			bucket.slowestDurationMs =
				bucket.slowestDurationMs === null
					? run.durationMs
					: Math.max(bucket.slowestDurationMs, run.durationMs);
			return accumulator;
		},
		{
			totalRuns: 0,
			totalDurationMs: 0,
			fastestDurationMs: null as number | null,
			slowestDurationMs: null as number | null,
			byProcessType: {
				asrs: {
					count: 0,
					averageDurationMs: 0,
					fastestDurationMs: null as number | null,
					slowestDurationMs: null as number | null
				},
				forklift: {
					count: 0,
					averageDurationMs: 0,
					fastestDurationMs: null as number | null,
					slowestDurationMs: null as number | null
				}
			}
		}
	);

	return {
		totalRuns: stats.totalRuns,
		averageDurationMs: stats.totalRuns > 0 ? stats.totalDurationMs / stats.totalRuns : 0,
		fastestDurationMs: stats.fastestDurationMs,
		slowestDurationMs: stats.slowestDurationMs,
		byProcessType: stats.byProcessType
	};
}

export function sortSimulationProcessRuns(
	runs: readonly SimulationProcessRun[]
): SimulationProcessRun[] {
	return [...runs].sort(
		(left, right) =>
			new Date(right.completedAt).getTime() - new Date(left.completedAt).getTime()
	);
}
