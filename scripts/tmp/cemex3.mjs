const page = await fetch('https://www.cemex.fr/produits/betons/cxb-hautes-performances', {
  headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', accept: 'text/html' },
  redirect: 'follow',
})
const html = await page.text()
let i = -1
while ((i = html.indexOf('/documents/d/', i + 1)) !== -1)
  console.log('pos', i, ':', JSON.stringify(html.slice(i - 60, i + 120)))
