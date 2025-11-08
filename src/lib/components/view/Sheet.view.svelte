<script context="module" lang="ts">
	export interface AreaPayload {
		id: string;
		name: string;
		current: any | null;
		upcomingCount: number;
	}
</script>

<script lang="ts">
	import {
		Sheet,
		SheetContent,
		SheetHeader,
		SheetTitle,
		SheetDescription,
		SheetFooter
	} from '@/components/ui/sheet';
	import { Button } from '@/components/ui/button';

	export let open = false;
	export let area: AreaPayload | null = null;
	export let onOpenChange: (v: boolean) => void = () => {};

	$: title = area?.name ?? 'Select a zone';
	$: subtitle = area
		? area.current
			? 'Work ongoing • live status'
			: area.upcomingCount > 0
				? `${area.upcomingCount} planned in next 24h`
				: 'No planned works in next 24h'
		: 'Tap a cadastral zone';
</script>

<div
	class="fixed inset-0 z-40"
	class:pointer-events-none={!open}
	role="button"
	tabindex="-1"
	on:click={() => open && onOpenChange(false)}
	on:keydown={(e) => {
		if (e.key === 'Escape') {
			onOpenChange(false);
		}
	}}
>
	<Sheet {open} {onOpenChange}>
		<!-- Bottom sheet -->
		<SheetContent
			side="bottom"
			class="glass sheet-overlay:!bg-transparent z-10
	           h-[38vh] rounded-t-3xl px-4 pt-2
	           pb-4 text-text-100
	           data-[state=closed]:animate-out
	           data-[state=closed]:slide-out-to-bottom-4 data-[state=open]:animate-in
	           data-[state=open]:slide-in-from-bottom-4 md:h-[42vh]"
		>
			<!-- Handle -->
			<div class="mx-auto mt-1 mb-2 h-1.5 w-10 rounded-full bg-white/20"></div>

			<SheetHeader class="mb-2">
				<SheetTitle class="text-lg md:text-xl">{title}</SheetTitle>
				<SheetDescription class="text-text-70">{subtitle}</SheetDescription>
			</SheetHeader>

			<!-- Content -->
			<div class="grid grid-cols-2 gap-2">
				<div class="rounded-xl border border-glass-stroke bg-surface-2/40 p-3">
					<div class="text-xs text-text-50">Status</div>
					<div class="mt-1 text-sm">
						{#if area?.current}
							<span class="inline-flex items-center gap-2">
								<span class="h-2 w-2 rounded-full bg-danger"></span>
								Ongoing work
							</span>
						{:else}
							<span class="inline-flex items-center gap-2">
								<span class="h-2 w-2 rounded-full bg-ok"></span>
								Normal
							</span>
						{/if}
					</div>
				</div>

				<div class="rounded-xl border border-glass-stroke bg-surface-2/40 p-3">
					<div class="text-xs text-text-50">Next 24h</div>
					<div class="mt-1 text-sm">{area?.upcomingCount ?? 0} planned</div>
				</div>

				<!-- You can add more cards here: last outage, avg duration, confidence, etc. -->
			</div>

			<SheetFooter class="mt-3 flex gap-2">
				<Button class="bg-primary-600 shadow-glow hover:bg-primary-700 rounded-xl text-[#0A0C12]">
					Enable alerts
				</Button>
				<Button variant="secondary" class="rounded-xl bg-surface-2">Save favorite</Button>
			</SheetFooter>
		</SheetContent>
	</Sheet>
</div>
