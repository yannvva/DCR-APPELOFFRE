const page = await fetch('https://www.cemex.fr/produits/betons/cxb-hautes-performances', {
  headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', accept: 'text/html' },
  redirect: 'follow',
})
const html = await page.text()
console.log('len:', html.length)
console.log('href total:', (html.match(/href=/g) ?? []).length)
console.log('documents/d:', (html.match(/documents\/d\//g) ?? []).length)
console.log('pdf:', (html.match(/\.pdf/gi) ?? []).length)
const all = [...html.matchAll(/href="([^"]{5,200})"/g)].map(m => m[1])
console.log(all.filter(h => !h.startsWith('#')).slice(0, 40))
