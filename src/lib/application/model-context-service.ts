import { get, writable, type Readable } from 'svelte/store';

import {
	formatTelemetrySummary,
	parseModelTelemetry,
	type ModelTelemetry,
	type TelemetryIssue,
	type TelemetrySource
} from '$lib/domain/model-telemetry';
import { parseSceneControlMessage } from '$lib/domain/scene-control';
import { ModelRegistry } from '$lib/domain/model-registry';
import { ModelTelemetrySocketClient } from '$lib/infrastructure/websocket/model-telemetry-socket';

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type ModelContextEventKind =
	| 'accepted'
	| 'rejected'
	| 'info'
	| 'socket-open'
	| 'socket-close'
	| 'socket-error'
	| 'cleared';

export type ModelContextEvent = Readonly<{
	id: number;
	at: string;
	kind: ModelContextEventKind;
	source: TelemetrySource | 'system';
	message: string;
	modelName?: string;
	details?: string[];
	raw?: string;
}>;

export type ModelConnectionState = Readonly<{
	status: ConnectionStatus;
	url: string;
	lastError: string | null;
	lastChangedAt: string | null;
}>;

export type ModelContextState = Readonly<{
	connection: ModelConnectionState;
	models: ModelTelemetry[];
	modelCount: number;
	events: ModelContextEvent[];
	lastAcceptedModel: ModelTelemetry | null;
	lastSummary: string | null;
}>;

const DEFAULT_WS_URL = 'ws://localhost:5173/telemetry';
const MAX_EVENTS = 80;

function nowIso(): string {
	return new Date().toISOString();
}

function issueLabel(issue: TelemetryIssue): string {
	return `${issue.severity.toUpperCase()} · ${issue.field} · ${issue.message}`;
}

function formatErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

function buildInitialState(): ModelContextState {
	return {
		connection: {
			status: 'idle',
			url: DEFAULT_WS_URL,
			lastError: null,
			lastChangedAt: null
		},
		models: [],
		modelCount: 0,
		events: [],
		lastAcceptedModel: null,
		lastSummary: null
	};
}

export class ModelContextService {
	private readonly registry = new ModelRegistry();
	private readonly socket = new ModelTelemetrySocketClient();
	private readonly store = writable<ModelContextState>(buildInitialState());
	private eventSequence = 0;

	subscribe: Readable<ModelContextState>['subscribe'] = this.store.subscribe;

	getSnapshot(): ModelContextState {
		return get(this.store);
	}

	setConnectionUrl(url: string): void {
		const nextUrl = url.trim() || DEFAULT_WS_URL;

		this.store.update((current) => ({
			...current,
			connection: {
				...current.connection,
				url: nextUrl,
				lastChangedAt: nowIso()
			}
		}));
	}

	connect(url = this.getSnapshot().connection.url): void {
		const connectionUrl = url.trim();

		if (!connectionUrl) {
			this.updateConnection({
				status: 'error',
				lastError: 'La URL del websocket no puede estar vacía.'
			});
			this.appendEvent({
				kind: 'info',
				source: 'system',
				message: 'No se pudo iniciar la conexión porque la URL está vacía.'
			});
			return;
		}

		this.setConnectionUrl(connectionUrl);
		this.updateConnection({
			status: 'connecting',
			lastError: null
		});

		try {
			this.socket.connect(connectionUrl, {
				onOpen: () => {
					this.updateConnection({
						status: 'connected',
						lastError: null
					});
					this.appendEvent({
						kind: 'socket-open',
						source: 'system',
						message: `Conexión abierta con ${connectionUrl}.`
					});
				},
				onClose: (event) => {
					this.updateConnection({
						status: 'disconnected',
						lastError: event.reason ? `Socket cerrado: ${event.reason}` : null
					});
					this.appendEvent({
						kind: 'socket-close',
						source: 'system',
						message: `Conexión cerrada. code=${event.code}${event.reason ? `, reason=${event.reason}` : ''}`
					});
				},
				onError: () => {
					this.updateConnection({
						status: 'error',
						lastError: 'Se produjo un error al conectar con el websocket.'
					});
					this.appendEvent({
						kind: 'socket-error',
						source: 'system',
						message: `Error de conexión con ${connectionUrl}.`
					});
				},
				onMessage: (message) => {
					this.ingest(message, 'websocket');
				}
			});
		} catch (error) {
			this.updateConnection({
				status: 'error',
				lastError: formatErrorMessage(error)
			});
			this.appendEvent({
				kind: 'socket-error',
				source: 'system',
				message: `No se pudo abrir la conexión: ${formatErrorMessage(error)}`
			});
		}
	}

	disconnect(): void {
		this.socket.disconnect();
		this.updateConnection({
			status: 'disconnected',
			lastError: null
		});
	}

	ingest(input: unknown, source: TelemetrySource = 'manual') {
		if (parseSceneControlMessage(input)) {
			return {
				ok: false,
				issues: [
					{
						field: 'control',
						message: 'Mensaje de control ignorado por el panel de contexto.',
						severity: 'warning'
					}
				]
			};
		}

		const result = parseModelTelemetry(input, source);

		if (result.ok) {
			this.registry.upsert(result.value);
			this.syncModelSnapshot(result.value, formatTelemetrySummary(result.value));

			this.appendEvent({
				kind: 'accepted',
				source,
				modelName: result.value.name,
				message: `Modelo registrado: ${formatTelemetrySummary(result.value)}`,
				details: result.warnings.map(issueLabel),
				raw: typeof input === 'string' ? input : undefined
			});
		} else {
			this.appendEvent({
				kind: 'rejected',
				source,
				message: `Telemetría rechazada: ${result.issues.map(issueLabel).join(' | ')}`,
				details: result.issues.map(issueLabel),
				raw: typeof input === 'string' ? input : undefined
			});
		}

		return result;
	}

	ingestRawText(text: string, source: TelemetrySource = 'manual') {
		return this.ingest(text, source);
	}

	publishTelemetryBatch(
		models: ModelTelemetry[],
		source: TelemetrySource = 'manual',
		message = 'Telemetría sincronizada con la escena.',
		summaryModel: ModelTelemetry | null = models.length > 0 ? models[models.length - 1] : null
	): void {
		if (models.length === 0) {
			return;
		}

		models.forEach((model) => {
			this.registry.upsert(model);
		});

		const snapshotModels = this.registry.list();
		const summary = summaryModel ?? snapshotModels[snapshotModels.length - 1] ?? null;

		this.store.update((current) => ({
			...current,
			models: snapshotModels,
			modelCount: snapshotModels.length,
			lastAcceptedModel: summary ?? current.lastAcceptedModel,
			lastSummary: summary ? formatTelemetrySummary(summary) : current.lastSummary
		}));

		this.appendEvent({
			kind: 'accepted',
			source,
			modelName: summary?.name,
			message,
			details: models.map((model) => formatTelemetrySummary(model))
		});
	}

	clear(): void {
		this.registry.clear();
		this.store.update((current) => ({
			...current,
			models: [],
			modelCount: 0,
			lastAcceptedModel: null,
			lastSummary: null
		}));

		this.appendEvent({
			kind: 'cleared',
			source: 'system',
			message: 'Se limpió el registro de modelos activos.'
		});
	}

	seedDemoData(): void {
		const baseTimestamp = nowIso();

		const demoMessages = [
			JSON.stringify({
				modelName: 'Forklift-01',
				position: { x: 2.4, y: 0, z: 3.2 },
				dimensions: { width: 1.8, height: 2.4, depth: 4.1 },
				timestamp: baseTimestamp
			}),
			JSON.stringify({
				name: 'ASRS-Rack-04',
				location: { x: 14, y: 0, z: 10.5 },
				volume: { width: 6, height: 12, depth: 2 },
				timestamp: baseTimestamp
			}),
			JSON.stringify({
				modelName: 'AGV-02',
				position: { x: 7.6, y: 0, z: 5.1 },
				volume: 8,
				timestamp: baseTimestamp
			})
		];

		demoMessages.forEach((message) => {
			this.ingest(message, 'demo');
		});

		this.appendEvent({
			kind: 'info',
			source: 'demo',
			message: 'Se cargó una escena de ejemplo para inspección textual de contexto.'
		});
	}

	private updateConnection(patch: Partial<ModelConnectionState>): void {
		this.store.update((current) => ({
			...current,
			connection: {
				...current.connection,
				...patch,
				lastChangedAt: nowIso()
			}
		}));
	}

	private syncModelSnapshot(
		lastAcceptedModel: ModelTelemetry | null,
		lastSummary: string | null
	): void {
		const models = this.registry.list();

		this.store.update((current) => ({
			...current,
			models,
			modelCount: models.length,
			lastAcceptedModel: lastAcceptedModel ?? current.lastAcceptedModel,
			lastSummary: lastSummary ?? current.lastSummary
		}));
	}

	private appendEvent(event: Omit<ModelContextEvent, 'id' | 'at'>): ModelContextEvent {
		const nextEvent: ModelContextEvent = {
			...event,
			id: ++this.eventSequence,
			at: nowIso()
		};

		this.store.update((current) => ({
			...current,
			events: [nextEvent, ...current.events].slice(0, MAX_EVENTS)
		}));

		return nextEvent;
	}
}

export function createModelContextService(): ModelContextService {
	return new ModelContextService();
}
