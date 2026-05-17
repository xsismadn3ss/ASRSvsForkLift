import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

import { telemetryWebSocketPlugin } from './src/lib/server/telemetry-websocket-server';

export default defineConfig({ plugins: [tailwindcss(), telemetryWebSocketPlugin(), sveltekit()] });
