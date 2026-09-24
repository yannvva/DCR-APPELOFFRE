import { NextResponse, type NextRequest } from 'next/server'
import { requireMembership } from '@/lib/dal/auth'
import { globalSearch } from '@/lib/dal/search'

export async function GET(request: NextRequest, { params }: RouteContext<'/api/[org]/search'>) {
  const { org: orgSlug } = await params
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? ''

  try {
    const ctx = await requireMembership(orgSlug)
    if (!ctx) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    if (q.length < 2) return NextResponse.json({ results: [] })
    const results = await globalSearch(ctx, q.slice(0, 100))
    return NextResponse.json({ results })
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
}
