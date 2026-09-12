'use client'

import * as React from 'react'
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Table as TanstackTable,
} from '@tanstack/react-table'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState, Skeleton } from '@/components/ui/states'
import { cn } from '@/lib/utils'

/**
 * DataTable — one table for every screen that needs one.
 *
 * Presentational on purpose: it takes `data` and `columns` and knows nothing
 * about where they came from. No fetching, no server actions, no assumptions
 * about a row beyond what the ColumnDefs declare. Admin triage, user
 * management and roster screens all drive it the same way.
 *
 * Styling is borrowed, not invented: Card/Input/Button plus the same table
 * classes the hand-rolled screens already use, so a DataTable sitting next to a
 * hand-written table is indistinguishable.
 */

/** Extra per-column hints, read via `metaOf` (no module augmentation needed). */
interface ColumnMetaShape {
  className?: string
  /** Set false to keep a column out of the CSV. */
  exportable?: boolean
  exportLabel?: string
}

function metaOf<TData, TValue>(column: Column<TData, TValue>): ColumnMetaShape {
  return (column.columnDef.meta ?? {}) as ColumnMetaShape
}

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  /** Renders skeleton rows instead of the body. */
  loading?: boolean
  /** Debounced, matched against every column. */
  searchPlaceholder?: string
  enableSearch?: boolean
  /**
   * Adds row checkboxes. Remember to include `selectColumn<T>()` in
   * `columns` — this flag alone only switches the selection model on.
   */
  enableSelection?: boolean
  enableExport?: boolean
  exportFilename?: string
  /** Page-size choices; defaults to the 10/25/50 the screens ask for. */
  pageSizeOptions?: number[]
  initialPageSize?: number
  emptyTitle?: string
  emptyDescription?: string
  /** Extra controls above the table, e.g. bulk actions for selected rows. */
  toolbar?: (table: TanstackTable<TData>) => React.ReactNode
  getRowId?: (row: TData, index: number) => string
  onSelectionChange?: (selected: TData[]) => void
  className?: string
}

export function DataTable<TData, TValue>({
  columns,
  data,
  loading = false,
  searchPlaceholder = 'Search…',
  enableSearch = true,
  enableSelection = false,
  enableExport = false,
  exportFilename = 'export.csv',
  pageSizeOptions = [10, 25, 50],
  initialPageSize = 10,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  toolbar,
  getRowId,
  onSelectionChange,
  className,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({})
  const [searchInput, setSearchInput] = React.useState('')
  const [globalFilter, setGlobalFilter] = React.useState('')
  // Controlled so the page-size <select> can reset to page 0 without an
  // effect that re-runs on every render.
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: initialPageSize,
  })

  // Typing should not re-filter on every keystroke. The timer lives in an
  // effect with a cleanup, so a fast typist triggers one pass, not one per key.
  React.useEffect(() => {
    const timer = setTimeout(() => setGlobalFilter(searchInput), 250)
    return () => clearTimeout(timer)
  }, [searchInput])

  const table = useReactTable({
    data,
    columns,
    state: { sorting, rowSelection, globalFilter, pagination },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableRowSelection: enableSelection,
    ...(getRowId ? { getRowId } : {}),
  })

  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original)

  // Report selection upward, but not on mount and not on every re-render.
  const lastReported = React.useRef('')
  React.useEffect(() => {
    const key = Object.keys(rowSelection).sort().join(',')
    if (key === lastReported.current) return
    lastReported.current = key
    onSelectionChange?.(selectedRows)
    // selectedRows is derived from rowSelection, so it is intentionally not a
    // dependency — including it would make the key comparison pointless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowSelection, onSelectionChange])

  const rows = table.getRowModel().rows
  const total = table.getFilteredRowModel().rows.length
  const first = total === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1
  const last = Math.min(first + rows.length - 1, total)

  return (
    <Card className={cn('overflow-hidden', className)}>
      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      {enableSearch || enableExport ? (
        <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-4">
          <div className="flex flex-1 flex-wrap items-center gap-3">
            {enableSearch ? (
              <div className="relative min-w-[220px] max-w-sm flex-1">
                <span className="material-symbols-outlined pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-subtle">
                  search
                </span>
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder={searchPlaceholder}
                  className="pl-10"
                  aria-label={searchPlaceholder}
                />
              </div>
            ) : null}

            {selectedRows.length > 0 ? (
              <span className="num text-xs text-muted">{selectedRows.length} selected</span>
            ) : null}
          </div>

          {enableExport ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadCsv(table, exportFilename, selectedRows.length > 0)}
              disabled={loading || total === 0}
              title="Download the filtered rows as CSV"
            >
              <span className="material-symbols-outlined text-[18px]">download</span>
              {selectedRows.length > 0 ? `Export ${selectedRows.length}` : 'Export CSV'}
            </Button>
          ) : null}
        </div>
      ) : null}

      {toolbar?.(table)}

      <CardContent className={cn('p-0', !enableSearch && !enableExport && 'pt-6')}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr
                  key={headerGroup.id}
                  className="border-y border-border text-xs uppercase tracking-wide text-muted"
                >
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort()
                    const sorted = header.column.getIsSorted()
                    return (
                      <th
                        key={header.id}
                        className={cn('px-4 py-2.5 text-left font-medium', metaOf(header.column).className)}
                      >
                        {header.isPlaceholder ? null : canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="inline-flex items-center gap-1 transition-colors hover:text-foreground"
                            aria-label={`Sort by ${String(header.column.columnDef.header ?? header.id)}`}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            <span className="material-symbols-outlined text-[14px] leading-none">
                              {sorted === 'asc'
                                ? 'arrow_upward'
                                : sorted === 'desc'
                                  ? 'arrow_downward'
                                  : 'swap_vert'}
                            </span>
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    )
                  })}
                </tr>
              ))}
            </thead>

            <tbody>
              {loading ? (
                <SkeletonRows rows={Math.min(pagination.pageSize, 5)} cols={columns.length} />
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(columns.length, 1)}>
                    <div className="p-6">
                      <EmptyState
                        icon="inbox"
                        title={globalFilter ? 'No matches' : emptyTitle}
                        description={
                          globalFilter
                            ? `Nothing matches “${globalFilter}”. Try a different search.`
                            : emptyDescription
                        }
                      />
                    </div>
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      'border-b border-border last:border-0 transition-colors',
                      row.getIsSelected() ? 'bg-accent-soft/40' : 'hover:bg-background'
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={cn('px-4 py-3', metaOf(cell.column).className)}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ──────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-6 py-3">
          <p className="num text-xs text-muted">
            {total === 0 ? 'No rows' : `${first}–${last} of ${total}`}
          </p>

          <div className="flex items-center gap-2">
            <label className="text-xs text-muted" htmlFor="data-table-page-size">
              Rows
            </label>
            <select
              id="data-table-page-size"
              value={pagination.pageSize}
              onChange={(e) =>
                setPagination({ pageIndex: 0, pageSize: Number(e.target.value) })
              }
              className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-foreground outline-none transition-colors focus:border-accent"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>

            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

/* ── Column helpers ────────────────────────────────────────────────────────── */

/**
 * Checkbox column. Add it to `columns` and pass `enableSelection`:
 *
 *   const cols = [selectColumn<Row>(), ...rest]
 *   <DataTable data={rows} columns={cols} enableSelection />
 */
export function selectColumn<TData>(): ColumnDef<TData, unknown> {
  return {
    id: 'select',
    enableSorting: false,
    header: ({ table }) => (
      <input
        type="checkbox"
        className="h-4 w-4 accent-accent"
        checked={table.getIsAllPageRowsSelected()}
        ref={(el) => {
          if (el) el.indeterminate = table.getIsSomePageRowsSelected()
        }}
        onChange={table.getToggleAllPageRowsSelectedHandler()}
        aria-label="Select all rows on this page"
      />
    ),
    cell: ({ row }) => (
      <input
        type="checkbox"
        className="h-4 w-4 accent-accent"
        checked={row.getIsSelected()}
        onChange={row.getToggleSelectedHandler()}
        aria-label={`Select row ${row.index + 1}`}
      />
    ),
  }
}

function SkeletonRows({ rows, cols }: { rows: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="border-b border-border last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <Skeleton className="h-4 w-full max-w-[10rem]" />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

/* ── CSV ───────────────────────────────────────────────────────────────────── */

/**
 * Export what the user is looking at: ticked rows if any, otherwise every row
 * that survived the filter, in the sorted order shown. Columns that render
 * controls (buttons, switches) carry no accessor and are skipped rather than
 * exported as "[object Object]".
 */
function downloadCsv<TData>(
  table: TanstackTable<TData>,
  filename: string,
  onlySelected: boolean
) {
  const selected = table.getSelectedRowModel().rows
  const source: Row<TData>[] = onlySelected && selected.length > 0
    ? selected
    : table.getSortedRowModel().rows

  const columns = table.getVisibleLeafColumns().filter(isExportable)

  const head = columns.map((column) => csvCell(exportHeader(column))).join(',')
  const body = source.map((row) =>
    columns.map((column) => csvCell(exportValue(column, row))).join(',')
  )

  // BOM so Excel reads UTF-8 names correctly.
  const csv = `﻿${[head, ...body].join('\r\n')}`
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function isExportable<TData>(column: Column<TData, unknown>): boolean {
  if (column.id === 'select') return false
  if (metaOf(column).exportable === false) return false
  const def = column.columnDef as { accessorKey?: unknown; accessorFn?: unknown }
  return Boolean(def.accessorKey || def.accessorFn)
}

function exportHeader<TData>(column: Column<TData, unknown>): string {
  const meta = metaOf(column)
  if (meta.exportLabel) return meta.exportLabel
  if (typeof column.columnDef.header === 'string') return column.columnDef.header
  return column.id
}

function exportValue<TData>(column: Column<TData, unknown>, row: Row<TData>): string {
  const def = column.columnDef as {
    accessorKey?: string
    accessorFn?: (row: TData, index: number) => unknown
  }

  if (def.accessorFn) return toText(def.accessorFn(row.original, row.index))
  if (def.accessorKey) return toText(readPath(row.original, def.accessorKey))
  return ''
}

/** Supports the dotted paths accessorKey allows, e.g. "student.regno". */
function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key]
    }
    return undefined
  }, source)
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'object') return ''
  return String(value)
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}
