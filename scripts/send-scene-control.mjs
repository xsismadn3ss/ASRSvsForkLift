import WebSocket from 'ws';

const [command = '', rawValue = ''] = process.argv.slice(2);
const validCommands = new Set([
	'pause',
	'resume',
	'toggle-pause',
	'speed-up',
	'speed-down',
	'set-speed',
	'reset',
	'restart'
]);

if (!validCommands.has(command)) {
	console.log(
		'Uso: node scripts/send-scene-control.mjs <pause|resume|toggle-pause|speed-up|speed-down|set-speed|reset|restart> [valor]'
	);
	process.exit(1);
}

const payload = {
	type: 'scene.control',
	command,
	...(command === 'set-speed' && Number.isFinite(Number(rawValue))
		? { value: Number(rawValue) }
		: {})
};

const socket = new WebSocket('ws://localhost:5173/control');

socket.on('open', () => {
	socket.send(JSON.stringify(payload));
	console.log(`Comando enviado: ${JSON.stringify(payload)}`);
	setTimeout(() => {
		socket.close();
	}, 150);
});

socket.on('close', () => {
	process.exit(0);
});

socket.on('error', (error) => {
	console.error(`Error enviando comando: ${error.message}`);
	process.exit(1);
});
