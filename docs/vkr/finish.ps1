param([string]$DocumentPath = (Join-Path $PSScriptRoot 'Пояснительная_записка_ОбъектМаркет.docx'))
$ErrorActionPreference='Stop'
$source=(Resolve-Path -LiteralPath $DocumentPath).Path
$application=New-Object -ComObject Word.Application
$application.Visible=$false
$application.DisplayAlerts=0
$document=$null
try {
    if ($application.Documents.Count -ne 0) { throw 'Новый экземпляр Word уже содержит документы; обновление отменено.' }
    $document=$application.Documents.Open($source,$false,$false)
    $document.Fields.Update() | Out-Null
    foreach ($toc in $document.TablesOfContents) {
        $toc.Range.Font.Name='Times New Roman'
        $toc.Range.Font.Size=10
        $toc.Range.ParagraphFormat.SpaceBefore=0
        $toc.Range.ParagraphFormat.SpaceAfter=0
        $toc.Range.ParagraphFormat.LineSpacingRule=0
        $toc.Range.ParagraphFormat.KeepWithNext=0
    }
    $document.Repaginate()
    $document.Fields.Update() | Out-Null
    $document.Save()
    Write-Output "Страниц: $($document.ComputeStatistics(2))"
} finally {
    if ($document) { $document.Close(0) }
    if ($application.Documents.Count -eq 0) { $application.Quit() }
    [Runtime.InteropServices.Marshal]::ReleaseComObject($application) | Out-Null
}
