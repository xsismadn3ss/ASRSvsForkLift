<script lang="ts">
	import { onMount } from 'svelte';

	import SimulationMetrics from '$lib/presentation/simulation-metrics/SimulationMetrics.svelte';
	import {
		calculateSimulationProcessSummary,
		type SimulationProcessRun,
		type SimulationProcessSummary
	} from '$lib/domain/simulation-process';

	let runs = $state<SimulationProcessRun[]>([]);
	let summary = $state<SimulationProcessSummary>(calculateSimulationProcessSummary([]));
	let loading = $state(true);
	let errorMessage = $state('');

	onMount(async () => {
		try {
			const response = await fetch('/api/simulation-runs?limit=200');
			if (!response.ok) {
				throw new Error(`No se pudieron cargar las métricas (${response.status})`);
			}

			const payload = (await response.json()) as { runs?: SimulationProcessRun[] };
			runs = Array.isArray(payload.runs) ? payload.runs : [];
			summary = calculateSimulationProcessSummary(runs);
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>Métricas de simulación</title>
	<meta
		name="description"
		content="Gráficas persistentes de duración para las simulaciones ASRS y Forklift."
	/>
</svelte:head>

<section class="min-h-screen bg-slate-950 px-6 py-6 text-slate-100">
	<div class="mx-auto max-w-7xl">
		<header class="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
			<div>
				<p class="mb-2 text-xs font-semibold tracking-[0.18em] text-sky-300/80 uppercase">
					DDD · SQLite · Prisma
				</p>
				<h1 class="text-3xl font-semibold tracking-tight text-white sm:text-4xl">
					Gráficas de duración
				</h1>
				<p class="mt-2 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
					Aquí se ve cuánto tarda cada proceso en completarse y cómo se comportan ASRS y Forklift a lo
					largo del tiempo.
				</p>
			</div>

			<a
				href="/"
				class="inline-flex items-center justify-center rounded-full border border-slate-500/25 bg-slate-800/80 px-4 py-3 text-sm font-medium text-slate-100 transition hover:border-sky-400/60"
			>
				Volver al panel
			</a>
		</header>

		{#if loading}
			<div class="rounded-3xl border border-slate-500/20 bg-slate-900/80 p-5 text-slate-300">
				Cargando métricas...
			</div>
		{:else if errorMessage}
			<div class="rounded-3xl border border-rose-400/30 bg-rose-950/40 p-5 text-rose-100">
				{errorMessage}
			</div>
		{:else}
			<SimulationMetrics {runs} {summary} />
		{/if}
	</div>
</section>
