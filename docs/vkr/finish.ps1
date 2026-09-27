$docPath = Join-Path $PSScriptRoot 'Пояснительная_записка_ОбъектМаркет.docx'
$word = New-Object -ComObject Word.Application
$word.Visible = $false
try {
    $doc = $word.Documents.Open($docPath)
    $doc.Fields.Update() | Out-Null
    $toc = $doc.TablesOfContents.Item(1)
    $toc.Range.Font.Name = 'Times New Roman'
    $toc.Range.Font.Size = 10
    $toc.Range.ParagraphFormat.SpaceBefore = 0
    $toc.Range.ParagraphFormat.SpaceAfter = 0
    $toc.Range.ParagraphFormat.LineSpacingRule = 0
    $toc.Range.ParagraphFormat.KeepWithNext = 0
    $doc.Repaginate()
    $doc.Fields.Update() | Out-Null
    $toc.Range.Font.Size = 10
    $toc.Range.ParagraphFormat.KeepWithNext = 0
    $doc.Save()
    Write-Output "Страниц: $($doc.ComputeStatistics(2))"
    $doc.Close(0)
} finally {
    $word.Quit()
}
