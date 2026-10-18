$Coord = if ($env:COORDINATOR_URL) { $env:COORDINATOR_URL } else { "http://localhost:8000" }
Write-Host "Running SHP-1042 demo against $Coord ..."
Invoke-RestMethod -Method Post -Uri "$Coord/demo/run-urgent-casablanca" | ConvertTo-Json -Depth 8
Write-Host "`nRecent audit:"
Invoke-RestMethod -Uri "$Coord/audit/recent?limit=5" | ConvertTo-Json -Depth 8
