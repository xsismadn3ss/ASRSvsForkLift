<script lang="ts">
	import {
		formatDurationMs,
		formatSimulationProcessLabel,
		type SimulationProcessRun,
		type SimulationProcessSummary
	} from '$lib/domain/simulation-process';

	let {
		runs,
		summary
	}: {
		runs: SimulationProcessRun[];
		summary: SimulationProcessSummary;
	} = $props();

	const recentRuns = $derived([...runs].slice(0, 12).reverse());
	const recentMaxDuration = $derived(Math.max(...recentRuns.map((run) => run.durationMs), 1));
	const averageByProcess = $derived([
		{
			type: 'asrs' as const,
			label: formatSimulationProcessLabel('asrs'),
			...summary.byProcessType.asrs
		},
		{
			type: 'forklift' as const,
			label: formatSimulationProcessLabel('forklift'),
			...summary.byProcessType.forklift
		}
	]);
	const averageMaxDuration = $derived(
		Math.max(...averageByProcess.map((item) => item.averageDurationMs), 1)
	);

	function dateLabel(value: string): string {
		return new Intl.DateTimeFormat('es-ES', {
			day: '2-digit',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(value));
	}

	function processTone(processType: 'asrs' | 'forklift'): string {
		return processType === 'asrs'
			? 'border-sky-400/30 bg-sky-400/10 text-sky-100'
			: 'border-violet-400/30 bg-violet-400/10 text-violet-100';
	}
</script>

<section class="grid gap-4">
	<div class="grid gap-4 md:grid-cols-4">
		<article class="rounded-3xl border border-slate-500/20 bg-slate-900/80 p-4">
			<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Procesos</p>
			<p class="mt-2 text-3xl font-semibold text-white">{summary.totalRuns}</p>
		</article>
		<article class="rounded-3xl border border-slate-500/20 bg-slate-900/80 p-4">
			<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Promedio</p>
			<p class="mt-2 text-3xl font-semibold text-white">{formatDurationMs(summary.averageDurationMs)}</p>
		</article>
		<article class="rounded-3xl border border-slate-500/20 bg-slate-900/80 p-4">
			<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Más rápido</p>
			<p class="mt-2 text-3xl font-semibold text-white">
				{summary.fastestDurationMs === null ? '—' : formatDurationMs(summary.fastestDurationMs)}
			</p>
		</article>
		<article class="rounded-3xl border border-slate-500/20 bg-slate-900/80 p-4">
			<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Más lento</p>
			<p class="mt-2 text-3xl font-semibold text-white">
				{summary.slowestDurationMs === null ? '—' : formatDurationMs(summary.slowestDurationMs)}
			</p>
		</article>
	</div>

	<div class="grid gap-4 xl:grid-cols-[1.7fr_1fr]">
		<section class="rounded-3xl border border-slate-500/20 bg-slate-900/80 p-5">
			<div class="mb-4">
				<h2 class="text-lg font-semibold text-white">Duración por corrida reciente</h2>
				<p class="mt-1 text-sm text-slate-300">
					Cada barra representa el tiempo necesario para completar un proceso completo.
				</p>
			</div>

	{#if recentRuns.length === 0}
		<div class="rounded-2xl border border-dashed border-slate-500/30 p-5 text-slate-300">
			Aún no hay corridas registradas.
		</div>
	{:else}
		<div class="overflow-x-auto rounded-2xl border border-slate-500/20 bg-slate-950/40 p-4">
			<div
				class="grid min-h-96 items-end gap-4"
				style={`grid-template-columns: repeat(${recentRuns.length}, minmax(11rem, 1fr));`}
			>
				{#each recentRuns as run}
					{@const barHeight = Math.max((run.durationMs / recentMaxDuration) * 260, 56)}
					<div class="flex h-full flex-col justify-end gap-3 text-center">
						<div class="flex h-72 items-end rounded-2xl bg-slate-800/70 px-3 pb-3">
							<div
								class={`w-full rounded-t-2xl ${run.processType === 'asrs' ? 'bg-linear-to-t from-sky-500 to-cyan-300' : 'bg-linear-to-t from-violet-600 to-fuchsia-300'}`}
								style={`height: ${barHeight}px;`}
							></div>
						</div>
						<p class="text-sm font-semibold text-white">{formatDurationMs(run.durationMs)}</p>
						<p class="text-[11px] text-slate-400">{dateLabel(run.completedAt)}</p>
						<p class="text-[11px] text-slate-500">{formatSimulationProcessLabel(run.processType)}</p>
					</div>
				{/each}
			</div>
		</div>
	{/if}
</section>

		<section class="rounded-3xl border border-slate-500/20 bg-slate-900/80 p-5">
			<div class="mb-4">
				<h2 class="text-lg font-semibold text-white">Promedio por tipo de proceso</h2>
				<p class="mt-1 text-sm text-slate-300">
					Compara la carga de trabajo entre ASRS y Forklift.
				</p>
			</div>

			<div class="grid gap-4">
				{#each averageByProcess as item}
					<div class="rounded-2xl border border-slate-500/20 bg-slate-950/60 p-4">
						<div class="flex items-center justify-between gap-4">
							<div>
								<p class={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${processTone(item.type)}`}>
									{item.label}
								</p>
								<p class="mt-2 text-xl font-semibold text-white">
									{formatDurationMs(item.averageDurationMs)}
								</p>
							</div>
							<p class="text-sm text-slate-300">{item.count} corridas</p>
						</div>

						<div class="mt-4 h-4 rounded-full bg-slate-800/90">
							<div
								class={`h-4 rounded-full ${item.type === 'asrs' ? 'bg-sky-500' : 'bg-violet-500'}`}
								style={`width: ${Math.max((item.averageDurationMs / averageMaxDuration) * 100, 6)}%`}
							></div>
						</div>
					</div>
				{/each}
			</div>
		</section>
	</div>

	<section class="rounded-3xl border border-slate-500/20 bg-slate-900/80 p-5">
		<div class="mb-4">
			<h2 class="text-lg font-semibold text-white">Historial persistido</h2>
			<p class="mt-1 text-sm text-slate-300">
				Los datos viven en SQLite y quedan disponibles para comparar ejecuciones anteriores.
			</p>
		</div>

		{#if runs.length === 0}
			<div class="rounded-2xl border border-dashed border-slate-500/30 p-5 text-slate-300">
				No hay registros aún.
			</div>
		{:else}
			<div class="overflow-x-auto rounded-2xl border border-slate-500/20">
				<table class="min-w-full border-collapse text-left text-sm">
					<thead class="bg-slate-950/70 text-xs tracking-[0.14em] text-slate-400 uppercase">
						<tr>
							<th class="px-4 py-3">Proceso</th>
							<th class="px-4 py-3">Duración</th>
							<th class="px-4 py-3">Fase</th>
							<th class="px-4 py-3">Cajas</th>
							<th class="px-4 py-3">Completado</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-800 bg-slate-950/40">
						{#each runs as run (run.id)}
							<tr class="align-top text-slate-200">
								<td class="px-4 py-3">
									<p class="font-semibold text-white">{formatSimulationProcessLabel(run.processType)}</p>
									<p class="mt-1 text-xs text-slate-400">{run.id}</p>
								</td>
								<td class="px-4 py-3">{formatDurationMs(run.durationMs)}</td>
								<td class="px-4 py-3">{run.completedPhase}</td>
								<td class="px-4 py-3">{run.loadsCompleted}</td>
								<td class="px-4 py-3 text-slate-300">{dateLabel(run.completedAt)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</section>
