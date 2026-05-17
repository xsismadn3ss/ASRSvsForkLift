<script lang="ts">
	import ModelDashboard from '$lib/presentation/model-dashboard/ModelDashboard.svelte';

	function openAsrsScene(): void {
		window.location.assign('/asrs');
	}

	function openForkliftScene(): void {
		window.location.assign('/forklift');
	}
</script>

<svelte:head>
	<title>Telemetría 3D</title>
	<meta
		name="description"
		content="Panel de contexto 3D con telemetría por websocket para las simulaciones ASRS y Forklift."
	/>
</svelte:head>

<section class="min-h-screen bg-slate-950 text-slate-100">
	<header
		class="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-6 md:flex-row md:items-end md:justify-between"
	>
		<div class="max-w-4xl">
			<p class="mb-2 text-xs font-semibold tracking-[0.18em] text-sky-300/80 uppercase">
				ASRS vs Forklift
			</p>
			<h1 class="mb-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl">
				Contexto textual de la simulación
			</h1>
			<p class="max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
				Aquí puedes ver la telemetría, el estado del websocket y el registro de modelos. La escena
				3D vive en una ruta separada para mantener cada responsabilidad aislada.
			</p>
		</div>

		<div class="flex flex-wrap gap-3">
			<button
				type="button"
				onclick={openAsrsScene}
				class="inline-flex items-center justify-center rounded-full bg-linear-to-r from-blue-600 to-violet-600 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-violet-950/30 transition hover:brightness-110 focus:ring-2 focus:ring-violet-400 focus:ring-offset-2 focus:ring-offset-slate-950 focus:outline-none"
			>
				Abrir escena ASRS
			</button>
			<button
				type="button"
				onclick={openForkliftScene}
				class="inline-flex items-center justify-center rounded-full border border-slate-500/25 bg-slate-800/80 px-4 py-3 text-sm font-medium text-slate-100 transition hover:border-sky-400/60"
			>
				Abrir escena Forklift
			</button>
		</div>
	</header>

	<div class="px-0 pb-8">
		<ModelDashboard />
	</div>
</section>
