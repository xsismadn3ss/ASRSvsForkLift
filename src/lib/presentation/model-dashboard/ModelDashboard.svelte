<script lang="ts">
	import { onMount } from 'svelte';
	import { get, writable } from 'svelte/store';

	import { modelContextService } from '$lib/application/model-context';
	import { type ModelContextState } from '$lib/application/model-context-service';
	import {
		formatDimensions3D,
		formatTelemetrySummary,
		formatTimestamp,
		formatVector3
	} from '$lib/domain/model-telemetry';

	const service = modelContextService;

	const state = writable<ModelContextState>(service.getSnapshot());
	const connectionUrl = writable('ws://localhost:5173/telemetry');
	const rawTelemetry = writable(
		JSON.stringify(
			{
				modelName: 'Forklift-01',
				position: { x: 1.2, y: 0, z: 4.5 },
				dimensions: { width: 1.8, height: 2.4, depth: 4.1 },
				timestamp: new Date().toISOString()
			},
			null,
			2
		)
	);

	const statusLabels: Record<ModelContextState['connection']['status'], string> = {
		idle: 'Inactivo',
		connecting: 'Conectando',
		connected: 'Conectado',
		disconnected: 'Desconectado',
		error: 'Error'
	} as const;

	function connectionTone(status: keyof typeof statusLabels): string {
		switch (status) {
			case 'connected':
				return 'border-emerald-400/30';
			case 'connecting':
				return 'border-amber-400/30';
			case 'error':
				return 'border-rose-400/35';
			default:
				return 'border-slate-500/20';
		}
	}

	function eventTone(kind: string): string {
		switch (kind) {
			case 'accepted':
				return 'border-emerald-400/30';
			case 'rejected':
			case 'socket-error':
				return 'border-rose-400/35';
			case 'socket-open':
				return 'border-emerald-400/30';
			case 'socket-close':
				return 'border-slate-500/20';
			case 'cleared':
				return 'border-amber-400/30';
			default:
				return 'border-slate-500/20';
		}
	}

	function connect(): void {
		service.connect(get(connectionUrl));
	}

	function disconnect(): void {
		service.disconnect();
	}

	function ingestRaw(): void {
		service.ingestRawText(get(rawTelemetry), 'manual');
	}

	function loadDemo(): void {
		service.seedDemoData();
	}

	function clearRegistry(): void {
		service.clear();
	}

	onMount(() => {
		const unsubscribe = service.subscribe((next) => {
			state.set(next);
			connectionUrl.set(next.connection.url);
		});

		service.connect(get(connectionUrl));

		return () => {
			unsubscribe();
			service.disconnect();
		};
	});
</script>

<section class="mx-auto max-w-7xl px-6 pb-8 text-slate-100">
	<header class="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
		<div>
			<p class="mb-2 text-xs font-semibold tracking-[0.18em] text-sky-300/80 uppercase">
				DDD · Telemetría 3D · WebSocket
			</p>
			<h2 class="mb-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
				Panel de contexto de modelos 3D
			</h2>
			<p class="max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
				Este panel transforma mensajes de telemetría en un registro textual claro para que puedas
				razarlos aunque no veamos la escena 3D.
			</p>
		</div>

		<div
			class={`rounded-2xl border bg-slate-900/80 p-4 shadow-xl shadow-black/20 ${connectionTone($state.connection.status)}`}
		>
			<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Conexión</p>
			<p class="mt-1 text-lg font-semibold text-white">{statusLabels[$state.connection.status]}</p>
			<p class="mt-1 text-sm break-all text-slate-300">{$connectionUrl}</p>
		</div>
	</header>

	<section class="mb-6 grid gap-4 md:grid-cols-3">
		<article
			class="rounded-2xl border border-slate-500/20 bg-slate-900/80 p-4 shadow-xl shadow-black/20"
		>
			<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">
				Modelos activos
			</p>
			<p class="mt-2 text-3xl font-semibold text-white">{$state.modelCount}</p>
			<p class="mt-2 text-sm text-slate-300">Actualizados desde websocket o carga manual.</p>
		</article>

		<article
			class="rounded-2xl border border-slate-500/20 bg-slate-900/80 p-4 shadow-xl shadow-black/20"
		>
			<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Último modelo</p>
			<p class="mt-2 truncate text-xl font-semibold text-white">
				{$state.lastAcceptedModel?.name ?? 'Sin datos'}
			</p>
			<p class="mt-2 text-sm text-slate-300">
				{$state.lastAcceptedModel
					? formatTimestamp($state.lastAcceptedModel.receivedAt)
					: 'Esperando telemetría.'}
			</p>
		</article>

		<article
			class="rounded-2xl border border-slate-500/20 bg-slate-900/80 p-4 shadow-xl shadow-black/20"
		>
			<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Último resumen</p>
			<p class="mt-2 line-clamp-3 text-sm font-medium text-white">
				{$state.lastSummary ?? 'Sin contexto todavía'}
			</p>
			<p class="mt-2 text-sm text-slate-300">
				Sirve como línea de contexto rápida para el razonamiento.
			</p>
		</article>
	</section>

	<div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_1.2fr]">
		<section
			class="rounded-3xl border border-slate-500/20 bg-slate-900/80 p-5 shadow-xl shadow-black/20"
		>
			<div class="mb-4">
				<h3 class="text-lg font-semibold text-white">Entrada y control de telemetría</h3>
				<p class="mt-1 text-sm text-slate-300">
					Prueba la capa de infraestructura sin depender todavía del render 3D.
				</p>
			</div>

			<label class="mb-4 block">
				<span class="mb-2 block text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase"
					>URL del websocket</span
				>
				<input
					bind:value={$connectionUrl}
					oninput={() => service.setConnectionUrl(get(connectionUrl))}
					placeholder="ws://localhost:8080"
					autocomplete="off"
					class="w-full rounded-2xl border border-slate-500/25 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 transition outline-none placeholder:text-slate-500 focus:border-sky-400/80 focus:ring-2 focus:ring-sky-400/20"
				/>
			</label>

			<div class="mb-4 flex flex-wrap gap-3">
				<button
					type="button"
					class="rounded-full bg-linear-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
					onclick={connect}
				>
					Conectar
				</button>
				<button
					type="button"
					class="rounded-full border border-slate-500/25 bg-slate-800/80 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-sky-400/60"
					onclick={disconnect}
				>
					Desconectar
				</button>
				<button
					type="button"
					class="rounded-full border border-slate-500/25 bg-slate-800/80 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-sky-400/60"
					onclick={loadDemo}
				>
					Cargar demo
				</button>
				<button
					type="button"
					class="rounded-full border border-slate-500/25 bg-slate-800/80 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-sky-400/60"
					onclick={clearRegistry}
				>
					Limpiar
				</button>
			</div>

			<label class="mb-4 block">
				<span class="mb-2 block text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase"
					>Mensaje JSON recibido o simulado</span
				>
				<textarea
					bind:value={$rawTelemetry}
					rows="14"
					spellcheck="false"
					class="min-h-60 w-full rounded-2xl border border-slate-500/25 bg-slate-950/80 px-4 py-3 font-mono text-sm text-slate-100 transition outline-none placeholder:text-slate-500 focus:border-sky-400/80 focus:ring-2 focus:ring-sky-400/20"
				></textarea>
			</label>

			<div class="mb-4">
				<button
					type="button"
					class="rounded-full bg-linear-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
					onclick={ingestRaw}
				>
					Analizar JSON
				</button>
			</div>

			{#if $state.connection.lastError}
				<div class="rounded-2xl border border-rose-400/35 bg-rose-950/40 p-4">
					<p class="text-xs font-semibold tracking-[0.14em] text-rose-200 uppercase">
						Último error
					</p>
					<p class="mt-2 text-sm text-rose-100">{$state.connection.lastError}</p>
				</div>
			{/if}
		</section>

		<section
			class="rounded-3xl border border-slate-500/20 bg-slate-900/80 p-5 shadow-xl shadow-black/20"
		>
			<div class="mb-4">
				<h3 class="text-lg font-semibold text-white">Modelos activos</h3>
				<p class="mt-1 text-sm text-slate-300">
					Registro ordenado para que puedas ver ubicación, volumen y origen de cada modelo.
				</p>
			</div>

			{#if $state.models.length === 0}
				<div class="rounded-2xl border border-dashed border-slate-500/30 p-5 text-slate-300">
					<p class="font-medium text-white">No hay modelos todavía.</p>
					<p class="mt-1 text-sm">Conecta un websocket o carga la demo para empezar.</p>
				</div>
			{:else}
				<div class="overflow-x-auto rounded-2xl border border-slate-500/20">
					<table class="min-w-full border-collapse text-left text-sm">
						<thead class="bg-slate-950/70 text-xs tracking-[0.14em] text-slate-400 uppercase">
							<tr>
								<th class="px-4 py-3">Modelo</th>
								<th class="px-4 py-3">Ubicación</th>
								<th class="px-4 py-3">Volumen</th>
								<th class="px-4 py-3">Origen</th>
								<th class="px-4 py-3">Recibido</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-800 bg-slate-950/40">
							{#each $state.models as model (model.id)}
								<tr class="align-top text-slate-200">
									<td class="px-4 py-3">
										<p class="font-semibold text-white">{model.name}</p>
										<p class="mt-1 text-xs text-slate-400">{model.id}</p>
									</td>
									<td class="px-4 py-3">{formatVector3(model.position)}</td>
									<td class="px-4 py-3">
										<p>{formatDimensions3D(model.dimensions)}</p>
										<p class="mt-1 text-xs text-slate-400">{model.volume.toFixed(2)} cubic units</p>
									</td>
									<td class="px-4 py-3 capitalize">{model.source}</td>
									<td class="px-4 py-3 text-slate-300">{formatTimestamp(model.receivedAt)}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}

			{#if $state.lastAcceptedModel}
				<div class="mt-4 rounded-2xl border border-slate-500/20 bg-slate-950/60 p-4">
					<h4 class="text-base font-semibold text-white">Último contexto registrado</h4>
					<p class="mt-2 text-sm wrap-break-word text-slate-200">
						{formatTelemetrySummary($state.lastAcceptedModel)}
					</p>
					<div class="mt-4 grid gap-4 sm:grid-cols-3">
						<div>
							<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">
								Ubicación
							</p>
							<p class="mt-1 text-sm text-slate-100">
								{formatVector3($state.lastAcceptedModel.position)}
							</p>
						</div>
						<div>
							<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">
								Volumen
							</p>
							<p class="mt-1 text-sm text-slate-100">
								{formatDimensions3D($state.lastAcceptedModel.dimensions)}
							</p>
						</div>
						<div>
							<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">
								Timestamp
							</p>
							<p class="mt-1 text-sm text-slate-100">
								{formatTimestamp($state.lastAcceptedModel.receivedAt)}
							</p>
						</div>
					</div>
				</div>
			{/if}
		</section>
	</div>

	<section
		class="mt-4 rounded-3xl border border-slate-500/20 bg-slate-900/80 p-5 shadow-xl shadow-black/20"
	>
		<div class="mb-4">
			<h3 class="text-lg font-semibold text-white">Log de eventos</h3>
			<p class="mt-1 text-sm text-slate-300">
				Este es el contexto textual que yo puedo inspeccionar para razonar sobre la simulación.
			</p>
		</div>

		{#if $state.events.length === 0}
			<div class="rounded-2xl border border-dashed border-slate-500/30 p-5 text-slate-300">
				<p class="font-medium text-white">Aún no hay eventos.</p>
			</div>
		{:else}
			<div class="grid gap-3">
				{#each $state.events.slice(0, 12) as event (event.id)}
					<article class={`rounded-2xl border bg-slate-950/70 p-4 ${eventTone(event.kind)}`}>
						<div class="mb-2 flex items-start justify-between gap-4">
							<p class="font-semibold text-white capitalize">{event.kind}</p>
							<p class="text-xs text-slate-400">{formatTimestamp(event.at)}</p>
						</div>
						<p class="text-sm text-slate-200">{event.message}</p>
						{#if event.modelName}
							<p
								class="mt-2 inline-flex rounded-full bg-sky-400/15 px-3 py-1 text-xs font-medium text-sky-100"
							>
								{event.modelName}
							</p>
						{/if}
						{#if event.details && event.details.length > 0}
							<ul class="mt-3 list-disc space-y-1 pl-5 text-sm text-slate-200">
								{#each event.details as detail (detail)}
									<li>{detail}</li>
								{/each}
							</ul>
						{/if}
					</article>
				{/each}
			</div>
		{/if}
	</section>
</section>
