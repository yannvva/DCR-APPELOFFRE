import 'server-only'

import type { ListParams, Paged } from '@/lib/types'

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

export function resolveListParams(params: ListParams) {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? DEFAULT_PAGE_SIZE))
  return { page, pageSize, from: (page - 1) * pageSize, to: page * pageSize - 1 }
}

export function toPaged<T>(rows: T[], count: number | null, page: number, pageSize: number): Paged<T> {
  return { rows, count: count ?? 0, page, pageSize }
}
