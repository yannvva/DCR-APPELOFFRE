const r = await fetch('https://www.cemex.fr/produits/betons/cxb-hautes-performances', { headers: { 'User-Agent': 'Mozilla/5.0' } })
const html = await r.text()
for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
  const href = m[1], label = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (!/documents|telechar|pdf|fiche/i.test(href + ' ' + label)) continue
  const isPdf = /\.pdf($|[?#])/i.test(href)
  const looksDoc = /fiche|notice|documentation|technique|telechar|téléchar|catalog|brochure|dop\b|doe\b|atec|dta|fdes|fds|certificat/i.test(`${label} ${href}`)
  console.log(`${isPdf?'PDF':looksDoc?'DOC ':'--- '} | ${href.slice(0,80)} | "${label.slice(0,60)}"`)
}
