import {
	PrismaClient,
	type SimulationProcessType as PrismaSimulationProcessType,
	type SimulationRun as PrismaSimulationRun
} from '@prisma/client';

import {
	createSimulationProcessRun,
	sortSimulationProcessRuns,
	type SimulationProcessRun,
	type SimulationProcessRunInput
} from '$lib/domain/simulation-process';

import { prisma } from './prisma';

function toPrismaProcessType(value: SimulationProcessRunInput['processType']): PrismaSimulationProcessType {
	return value === 'asrs' ? 'ASRS' : 'FORKLIFT';
}

function fromPrismaProcessType(value: PrismaSimulationProcessType): SimulationProcessRunInput['processType'] {
	return value === 'ASRS' ? 'asrs' : 'forklift';
}

function mapSimulationRun(record: PrismaSimulationRun): SimulationProcessRun {
	return createSimulationProcessRun({
		id: record.id,
		processType: fromPrismaProcessType(record.processType),
		startedAt: record.startedAt.toISOString(),
		completedAt: record.completedAt.toISOString(),
		completedPhase: record.completedPhase,
		message: record.message,
		loadsCompleted: record.loadsCompleted
	});
}

function normalizeLimit(limit: number): number {
	if (!Number.isFinite(limit)) {
		return 120;
	}

	return Math.min(300, Math.max(1, Math.trunc(limit)));
}

export class SimulationRunStore {
	constructor(private readonly client: PrismaClient = prisma) {}

	async record(input: SimulationProcessRunInput): Promise<SimulationProcessRun> {
		const run = createSimulationProcessRun(input);
		const persisted = await this.client.simulationRun.upsert({
			where: {
				id: run.id
			},
			create: {
				id: run.id,
				processType: toPrismaProcessType(run.processType),
				startedAt: new Date(run.startedAt),
				completedAt: new Date(run.completedAt),
				durationMs: run.durationMs,
				completedPhase: run.completedPhase,
				message: run.message,
				loadsCompleted: run.loadsCompleted
			},
			update: {
				processType: toPrismaProcessType(run.processType),
				startedAt: new Date(run.startedAt),
				completedAt: new Date(run.completedAt),
				durationMs: run.durationMs,
				completedPhase: run.completedPhase,
				message: run.message,
				loadsCompleted: run.loadsCompleted
			}
		});

		return mapSimulationRun(persisted);
	}

	async listRecent(limit = 120): Promise<SimulationProcessRun[]> {
		const rows = await this.client.simulationRun.findMany({
			orderBy: [
				{
					completedAt: 'desc'
				},
				{
					createdAt: 'desc'
				}
			],
			take: normalizeLimit(limit)
		});

		return sortSimulationProcessRuns(rows.map(mapSimulationRun));
	}
}

export const simulationRunStore = new SimulationRunStore();
