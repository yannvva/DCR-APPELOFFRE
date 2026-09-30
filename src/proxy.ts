import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const PUBLIC_PATHS = ['/login', '/signup', '/auth/callback']

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isPublic =
    PUBLIC_PATHS.some((p) => path.startsWith(p)) ||
    path === '/' ||
    path.startsWith('/invite')

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    // Cible complète (path + query) pour revenir sur la bonne page/onglet.
    url.searchParams.set('next', path + request.nextUrl.search)
    return NextResponse.redirect(url)
  }

  if (user && (path === '/login' || path === '/signup')) {
    const url = request.nextUrl.clone()
    const next = request.nextUrl.searchParams.get('next')
    if (next?.startsWith('/') && !next.startsWith('//')) {
      url.pathname = next
      url.search = ''
    } else {
      url.pathname = '/'
      url.search = ''
    }
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
