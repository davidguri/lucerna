<script lang="ts" module>
	export interface AreaPayload {
		id: string;
		name: string;
		current: any | null;
		upcomingCount: number;
	}
</script>

<script lang="ts">
	export let area: AreaPayload | null = null;
	export let onOpen: () => void = () => {};
</script>

<!-- Always visible preview -->
<button
	class="glass shadow-glow fixed bottom-[calc(env(safe-area-inset-bottom,0px)+12px)]
         left-1/2
         z-10 flex w-[94%]
         max-w-[640px] -translate-x-1/2 items-center
         justify-between gap-3 rounded-2xl px-4
         py-2.5 text-text-100
         transition active:scale-[0.99]"
	on:click={onOpen}
>
	<div class="flex min-w-0 items-center gap-2">
		<!-- status dot -->
		<span
			class="h-2.5 w-2.5 shrink-0 rounded-full"
			style="background: {area?.current ? 'bg-danger' : 'bg-ok'}"
		></span>
		<div class="truncate">
			<div class="truncate text-sm font-medium">{area?.name ?? 'Lucerna'}</div>
			<div class="truncate text-xs text-text-70">
				{area?.current
					? 'Ongoing work'
					: area?.upcomingCount && area?.upcomingCount > 0
						? `${area?.upcomingCount} planned • 24h`
						: 'All clear'}
			</div>
		</div>
	</div>
	<!-- chevron icon (inline SVG to avoid deps) -->
	<svg width="18" height="18" viewBox="0 0 24 24" class="shrink-0 opacity-80">
		<path
			d="M8 10l4 4 4-4"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
		/>
	</svg>
</button>
