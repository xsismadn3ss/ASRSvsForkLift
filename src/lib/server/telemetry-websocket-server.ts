import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';

import {
	formatTelemetrySummary,
	formatTimestamp,
	parseModelTelemetry
} from '../domain/model-telemetry';
import { formatSceneControlLabel, parseSceneControlMessage } from '../domain/scene-control';
import WebSocket, { WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import type { Plugin } from 'vite';

type RouteName = 'telemetry' | 'control';

type ClientLogBuffer = Readonly<{
	messages: string[];
	flushTimer: ReturnType<typeof setInterval>;
}>;

const telemetryBuffers = new Map<WebSocket, ClientLogBuffer>();
const controlBuffers = new Map<WebSocket, ClientLogBuffer>();

function formatClientLabel(request: IncomingMessage): string {
	const address = request.socket.remoteAddress ?? 'unknown-address';
	const port = request.socket.remotePort ?? 0;
	return `${address}:${port}`;
}

function broadcast(server: WebSocketServer, payload: string, sender: WebSocket): void {
	for (const client of server.clients) {
		if (client.readyState === WebSocket.OPEN && client !== sender) {
			client.send(payload);
		}
	}
}

function flushBuffer(
	map: Map<WebSocket, ClientLogBuffer>,
	client: WebSocket,
	clientLabel: string,
	route: RouteName
): void {
	const buffer = map.get(client);
	if (!buffer || buffer.messages.length === 0) {
		return;
	}

	const lines = buffer.messages.join(' || ');
	console.log(`[${route}] client ${clientLabel} | ${buffer.messages.length} updates | ${lines}`);
	buffer.messages.length = 0;
}

function cleanupClient(map: Map<WebSocket, ClientLogBuffer>, client: WebSocket): void {
	const buffer = map.get(client);
	if (!buffer) {
		return;
	}

	clearInterval(buffer.flushTimer);
	map.delete(client);
}

function logTelemetryPayload(
	raw: string,
	client: WebSocket,
	map: Map<WebSocket, ClientLogBuffer>
): void {
	const result = parseModelTelemetry(raw, 'websocket');

	if (!result.ok) {
		const issues = result.issues
			.map((issue) => `${issue.severity}:${issue.field}:${issue.message}`)
			.join(' | ');
		console.log(`[telemetry][invalid] ${issues}`);
		console.log(`[telemetry][raw] ${raw}`);
		return;
	}

	const summary = formatTelemetrySummary(result.value);
	const timestamp = formatTimestamp(result.value.receivedAt);
	const entry = `${timestamp} :: ${summary}`;
	const buffer = map.get(client);

	if (buffer) {
		buffer.messages.push(entry);
	}
}

function logControlPayload(raw: string): void {
	const message = parseSceneControlMessage(raw);

	if (!message) {
		console.log(`[control][invalid] ${raw}`);
		return;
	}

	console.log(`[control] ${formatSceneControlLabel(message)}`);
}

function registerRoute(
	server: WebSocketServer,
	map: Map<WebSocket, ClientLogBuffer>,
	route: RouteName,
	options: {
		onMessage: (raw: string, websocket: WebSocket, server: WebSocketServer) => void;
	}
): void {
	server.on('connection', (websocket: WebSocket, request: IncomingMessage) => {
		const clientLabel = formatClientLabel(request);
		console.log(`[${route}] client connected ${clientLabel}`);

		const flushTimer = setInterval(() => {
			flushBuffer(map, websocket, clientLabel, route);
		}, 1000);

		map.set(websocket, {
			messages: [],
			flushTimer
		});

		websocket.on('message', (data: RawData) => {
			const raw = typeof data === 'string' ? data : data.toString('utf8');
			options.onMessage(raw, websocket, server);
		});

		websocket.on('close', () => {
			flushBuffer(map, websocket, clientLabel, route);
			cleanupClient(map, websocket);
			console.log(`[${route}] client disconnected ${clientLabel}`);
		});
	});
}

export function telemetryWebSocketPlugin(): Plugin {
	return {
		name: 'telemetry-websocket-server',
		configureServer(server) {
			if (!server.httpServer) {
				return;
			}

			const telemetryServer = new WebSocketServer({ noServer: true });
			const controlServer = new WebSocketServer({ noServer: true });

			server.httpServer.on('upgrade', (request: IncomingMessage, socket: Socket, head) => {
				const url = new URL(request.url ?? '', 'http://localhost');

				if (url.pathname === '/telemetry') {
					telemetryServer.handleUpgrade(request, socket, head, (websocket) => {
						telemetryServer.emit('connection', websocket, request);
					});
					return;
				}

				if (url.pathname === '/control') {
					controlServer.handleUpgrade(request, socket, head, (websocket) => {
						controlServer.emit('connection', websocket, request);
					});
					return;
				}
			});

			registerRoute(telemetryServer, telemetryBuffers, 'telemetry', {
				onMessage: (raw, websocket, telemetryRouteServer) => {
					logTelemetryPayload(raw, websocket, telemetryBuffers);
					const result = parseModelTelemetry(raw, 'websocket');

					if (result.ok) {
						broadcast(telemetryRouteServer, raw, websocket);
					}
				}
			});

			registerRoute(controlServer, controlBuffers, 'control', {
				onMessage: (raw, websocket, controlRouteServer) => {
					const message = parseSceneControlMessage(raw);
					if (!message) {
						logControlPayload(raw);
						return;
					}

					logControlPayload(raw);
					broadcast(controlRouteServer, raw, websocket);
				}
			});

			console.log('[telemetry] websocket listening at ws://localhost:5173/telemetry');
			console.log('[control] websocket listening at ws://localhost:5173/control');
		}
	};
}
