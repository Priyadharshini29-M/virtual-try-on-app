# Download test images
Write-Host "Downloading avatar..."
curl.exe -L -s -o "$PSScriptRoot\avatar.jpg" "https://images.pexels.com/photos/415829/pexels-photo-415829.jpeg?w=400"

Write-Host "Downloading clothing..."
curl.exe -L -s -o "$PSScriptRoot\clothing.jpg" "https://images.pexels.com/photos/1040945/pexels-photo-1040945.jpeg?w=400"

# Verify files
$avatar = Get-Item "$PSScriptRoot\avatar.jpg" -ErrorAction SilentlyContinue
$clothing = Get-Item "$PSScriptRoot\clothing.jpg" -ErrorAction SilentlyContinue

if (-not $avatar -or $avatar.Length -lt 1000) { Write-Error "avatar.jpg missing or too small"; exit 1 }
if (-not $clothing -or $clothing.Length -lt 1000) { Write-Error "clothing.jpg missing or too small"; exit 1 }

Write-Host "avatar.jpg: $($avatar.Length) bytes"
Write-Host "clothing.jpg: $($clothing.Length) bytes"

# Call API
Write-Host "Calling try-on API..."
curl.exe -X POST "https://try-on-diffusion.p.rapidapi.com/try-on-file" -H "X-RapidAPI-Key: 1517b92000mshc25c3f285bab0d0p155923jsnf863a8f84f38" -H "X-RapidAPI-Host: try-on-diffusion.p.rapidapi.com" -F "clothing_image=@$PSScriptRoot\clothing.jpg" -F "avatar_image=@$PSScriptRoot\avatar.jpg" -F "seed=-1" --output "$PSScriptRoot\result.jpg" -w "\nHTTP Status: %{http_code}\n"

Write-Host "Done. Check result.jpg"
