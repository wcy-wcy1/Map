param([string]$Stage = 'wikipedia')
$ErrorActionPreference = 'Stop'
$researchRoot = Join-Path $PSScriptRoot '../qa/national-expansion-20261023'
function Fetch-Research([string]$uri) {
  for ($attempt = 0; $attempt -lt 3; $attempt++) {
    try { return Invoke-WebRequest -Uri $uri -TimeoutSec 35 }
    catch { if ($attempt -eq 2) { throw }; Start-Sleep -Seconds 2 }
  }
}
$candidates = Get-Content -LiteralPath (Join-Path $researchRoot 'other-candidates.json') -Raw | ConvertFrom-Json
if ($Stage -eq 'wikipedia') {
  for ($i = 0; $i -lt $candidates.Count; $i += 20) {
    $batch = @($candidates | Select-Object -Skip $i -First 20)
    $titles = [Uri]::EscapeDataString(($batch.title -join '|'))
    $uri = "https://zh.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&converttitles=1&titles=$titles&prop=coordinates%7Crevisions%7Cpageprops&colimit=max&coprimary=primary&rvprop=ids%7Ctimestamp"
    $name = 'other-wikipedia-{0:d2}.json' -f ($i / 20 + 1)
    if (Test-Path -LiteralPath (Join-Path $researchRoot $name)) { continue }
    $response = Fetch-Research $uri
    $response.Content | Set-Content -LiteralPath (Join-Path $researchRoot $name) -Encoding utf8
    @{url=$uri;fetchedAt=[DateTime]::UtcNow.ToString('o');candidateIds=$batch.id} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $researchRoot ($name + '.meta.json')) -Encoding utf8
    Write-Output "saved $name"
  }
} elseif ($Stage -eq 'wikidata') {
  $ids = @(Get-Content -LiteralPath (Join-Path $researchRoot 'other-wikidata-ids.json') -Raw | ConvertFrom-Json)
  for ($i = 0; $i -lt $ids.Count; $i += 20) {
    $batch = @($ids | Select-Object -Skip $i -First 20)
    $encoded = [Uri]::EscapeDataString(($batch -join '|'))
    $uri = "https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&ids=$encoded&props=info%7Clabels%7Cclaims&languages=zh%7Cen"
    $name = 'other-wikidata-{0:d2}.json' -f ($i / 20 + 1)
    if (Test-Path -LiteralPath (Join-Path $researchRoot $name)) { continue }
    (Fetch-Research $uri).Content | Set-Content -LiteralPath (Join-Path $researchRoot $name) -Encoding utf8
    @{url=$uri;fetchedAt=[DateTime]::UtcNow.ToString('o');entities=$batch} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $researchRoot ($name + '.meta.json')) -Encoding utf8
    Write-Output "saved $name"
  }
}
