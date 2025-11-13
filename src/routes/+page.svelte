<script lang="ts">
	import Map from '@/components/view/Map.view.svelte';
	// import Sheet, { type AreaPayload } from '@/components/view/Sheet.view.svelte';
	// import PeekBar from '@/components/view/PeekBar.view.svelte';

	// let sheetOpen = false;
	// let selected: AreaPayload | null = null;

	// function onSelect(area: AreaPayload): void {
	// 	selected = area;
	// 	sheetOpen = true;
	// }
</script>

<div class="fixed inset-0">
	<Map />
</div>
