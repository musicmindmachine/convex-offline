<script lang="ts">
  import { useLiveQuery } from "@tanstack/svelte-db";
  import { getFilterContext } from "$lib/contexts/filters.svelte";
  import IntervalRow from "$lib/components/IntervalRow.svelte";
  import IntervalListSkeleton from "$lib/components/IntervalListSkeleton.svelte";
  import { intervals as intervalsLazy } from "$collections/useIntervals";
  import {
    createSvelteTable,
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
    type ColumnDef,
    type SortingState,
    type ColumnFiltersState,
  } from "$lib/components/ui/data-table";
  import type { Interval } from "$lib/types";

  const collection = intervalsLazy.get();
  const intervalsQuery = useLiveQuery(collection);
  const filters = getFilterContext();

  const intervals = $derived(intervalsQuery.data ?? []) as Interval[];

  let sorting = $state<SortingState>([{ id: "updatedAt", desc: true }]);
  let columnFilters = $state<ColumnFiltersState>([]);

  $effect(() => {
    const newFilters: ColumnFiltersState = [];
    if (filters.statusFilter) {
      newFilters.push({ id: "status", value: filters.statusFilter });
    }
    if (filters.priorityFilter) {
      newFilters.push({ id: "priority", value: filters.priorityFilter });
    }
    columnFilters = newFilters;
  });

  const columns: ColumnDef<Interval, unknown>[] = [
    { accessorKey: "id" },
    { accessorKey: "status", filterFn: "equals" },
    { accessorKey: "title" },
    { accessorKey: "priority", filterFn: "equals" },
    { accessorKey: "updatedAt" },
  ];

  const table = createSvelteTable<Interval>({
    get data() { return intervals; },
    columns,
    state: {
      get sorting() { return sorting; },
      get columnFilters() { return columnFilters; },
    },
    onSortingChange: (updater) => {
      sorting = typeof updater === "function" ? updater(sorting) : updater;
    },
    onColumnFiltersChange: (updater) => {
      columnFilters = typeof updater === "function" ? updater(columnFilters) : updater;
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const rows = $derived(table.getRowModel().rows);
</script>

{#if intervalsQuery.isLoading}
  <IntervalListSkeleton />
{:else}
<div class="flex-1 flex flex-col min-h-0">
  {#if rows.length === 0}
    <div class="flex flex-col items-center justify-center py-16 text-muted-foreground text-center">
      {#if intervals.length === 0}
        <p class="m-0">No intervals yet</p>
        <p class="text-xs opacity-60 mt-1">
          Press
          <kbd class="inline-block px-1.5 py-0.5 mx-0.5 font-mono text-[0.6875rem] bg-background border border-border rounded-sm">&#x2325;</kbd>
          <kbd class="inline-block px-1.5 py-0.5 mx-0.5 font-mono text-[0.6875rem] bg-background border border-border rounded-sm">N</kbd>
          to create your first interval
        </p>
      {:else}
        <p class="m-0">No intervals match your filters</p>
      {/if}
    </div>
  {:else}
    <div class="flex-1 overflow-auto">
      {#each rows as row (row.id)}
        {@const interval = row.original as Interval}
        <IntervalRow {interval} />
      {/each}
    </div>
  {/if}
</div>
{/if}
