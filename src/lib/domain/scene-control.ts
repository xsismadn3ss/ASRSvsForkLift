export type SceneControlCommand =
	| 'pause'
	| 'resume'
	| 'toggle-pause'
	| 'speed-up'
	| 'speed-down'
	| 'set-speed'
	| 'reset'
	| 'restart';

export type SceneControlMessage = Readonly<{
	type: 'scene.control';
	command: SceneControlCommand;
	value?: number;
}>;

export function parseSceneControlMessage(input: unknown): SceneControlMessage | null {
	let payload: unknown = input;

	if (typeof input === 'string') {
		try {
			payload = JSON.parse(input);
		} catch {
			return null;
		}
	}

	if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
		return null;
	}

	const candidate = payload as Readonly<Record<string, unknown>>;

	if (candidate.type !== 'scene.control') {
		return null;
	}

	const command = candidate.command;
	if (
		command !== 'pause' &&
		command !== 'resume' &&
		command !== 'toggle-pause' &&
		command !== 'speed-up' &&
		command !== 'speed-down' &&
		command !== 'set-speed' &&
		command !== 'reset' &&
		command !== 'restart'
	) {
		return null;
	}

	const value = typeof candidate.value === 'number' && Number.isFinite(candidate.value)
		? candidate.value
		: undefined;

	return {
		type: 'scene.control',
		command,
		...(value === undefined ? {} : { value })
	};
}

export function formatSceneControlLabel(message: SceneControlMessage): string {
	const value = message.value === undefined ? '' : ` value=${message.value.toFixed(2)}`;
	return `scene.control:${message.command}${value}`;
}
