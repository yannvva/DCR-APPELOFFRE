const page = await fetch('https://www.cemex.fr/produits/betons/cxb-hautes-performances', {
  headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', accept: 'text/html' },
  redirect: 'follow',
})
console.log('PAGE', page.status, page.url)
const html = (await page.text()).slice(0, 400_000)
const hrefs = [...html.matchAll(/href="([^"]*(?:documents|document|download|\.pdf)[^"]*)"/gi)]
  .map(m => m[1])
console.log('href candidats:', [...new Set(hrefs)].slice(0, 15))
const candidates = [...new Set(hrefs)]
  .map(h => h.startsWith('http') ? h : `https://www.cemex.fr${h.startsWith('/') ? '' : '/'}${h}`)
for (const u of candidates.slice(0, 8)) {
  try {
    const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36' }, redirect: 'follow', signal: AbortSignal.timeout(20000) })
    const buf = Buffer.from(await r.arrayBuffer())
    console.log('TRY', u, '→', r.status, r.headers.get('content-type'), JSON.stringify(buf.subarray(0,8).toString()), 'final=', r.url.slice(0, 110))
  } catch (e) { console.log('ERR', u, String(e).slice(0, 100)) }
}
