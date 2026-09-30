$word = New-Object -ComObject Word.Application
$word.Visible = $false
foreach ($n in 'DC1','DC2') {
  $src = "C:\Users\pc-dcr1\Desktop\$n - TEMPLATE.doc"
  $dst = "C:\Users\pc-dcr1\Desktop\$n-TEMPLATE.docx"
  $doc = $word.Documents.Open($src, $false, $true)
  $doc.SaveAs([ref]$dst, [ref]12)  # 12 = wdFormatXMLDocument (.docx)
  $doc.Close($false)
}
$word.Quit()
Write-Output 'OK'
