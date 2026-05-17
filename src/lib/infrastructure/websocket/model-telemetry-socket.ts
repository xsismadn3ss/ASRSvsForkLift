export type SocketConnectionHandlers = Readonly<{
	onOpen: () => void;
	onClose: (event: CloseEvent) => void;
	onError: (event: Event) => void;
	onMessage: (message: string) => void;
}>;

export class ModelTelemetrySocketClient {
	private socket: WebSocket | null = null;

	connect(url: string, handlers: SocketConnectionHandlers): void {
		this.disconnect();

		if (typeof WebSocket === 'undefined') {
			throw new Error('WebSocket no está disponible en este entorno.');
		}

		const socket = new WebSocket(url);
		this.socket = socket;

		socket.onopen = () => {
			handlers.onOpen();
		};

		socket.onclose = (event) => {
			if (this.socket === socket) {
				this.socket = null;
			}

			handlers.onClose(event);
		};

		socket.onerror = (event) => {
			handlers.onError(event);
		};

		socket.onmessage = (event) => {
			if (typeof event.data === 'string') {
				handlers.onMessage(event.data);
				return;
			}

			if (event.data instanceof Blob) {
				void event.data.text().then((text) => handlers.onMessage(text));
				return;
			}

			handlers.onMessage(String(event.data));
		};
	}

	disconnect(reason = 'Cierre solicitado desde la interfaz'): void {
		if (this.socket) {
			this.socket.close(1000, reason);
			this.socket = null;
		}
	}

	send(message: string): void {
		if (this.socket?.readyState === 1) {
			this.socket.send(message);
		}
	}

	get isConnected(): boolean {
		return this.socket?.readyState === 1;
	}
}
