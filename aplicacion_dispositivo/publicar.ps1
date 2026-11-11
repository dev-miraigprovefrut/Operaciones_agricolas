# Compila, FIRMA y publica una version nueva del APK "Tractor Nintanga".
# Las tablets la ven sola al abrir la app con señal (boton "Actualizar").
#
# Uso (desde esta carpeta, con `aws sso login --profile mirai-dev` hecho):
#   .\publicar.ps1 -Notas "Teclado en pantalla y modo oscuro"
#   .\publicar.ps1 -Notas "..." -SoloCompilar     # firma pero NO sube (para probar en una tablet)
#
# Requisitos: Node, JDK 21 (Adoptium), Android SDK, AWS CLI.
# La clave de firma esta SOLO en Secrets Manager (operacionesagricolas/apk-firma):
# sin ella las tablets no aceptan la actualizacion encima de la app instalada.
param(
    [Parameter(Mandatory = $true)][string]$Notas,
    [switch]$SoloCompilar,
    [string]$Perfil = 'mirai-dev'
)
# Continue: vite/gradle escriben avisos por stderr y PowerShell 5 los toma como error;
# cada paso revisa $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
$app = $PSScriptRoot
$front = Join-Path (Split-Path $app) 'frontend'
$bucket = 'operacionesagricolas'
$env:JAVA_HOME = 'C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot'
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"

# 1. Numero de version: el publicado + 1
$codigo = 1
try {
    $actual = aws s3 cp "s3://$bucket/apk/version.json" - --profile $Perfil 2>$null | ConvertFrom-Json
    if ($actual.version_code) { $codigo = [int]$actual.version_code + 1 }
} catch { }
$nombre = "1.$codigo"
Write-Host "Version $nombre (codigo $codigo)"

# 2. Web con el numero de version adentro
$env:VITE_APK_VERSION_CODE = "$codigo"; $env:VITE_APK_VERSION_NAME = $nombre
Push-Location $front
try { npx vite build; if ($LASTEXITCODE) { throw 'Fallo vite build' } } finally { Pop-Location }
Remove-Item Env:VITE_APK_VERSION_CODE, Env:VITE_APK_VERSION_NAME
Remove-Item "$app\www" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$front\dist" "$app\www" -Recurse
Remove-Item "$app\www\sw.js" -ErrorAction SilentlyContinue
Push-Location $app
try { npx cap sync android; if ($LASTEXITCODE) { throw 'Fallo cap sync' } } finally { Pop-Location }

# 3. Clave de firma a un archivo temporal (se borra al terminar)
$firma = aws secretsmanager get-secret-value --profile $Perfil --region us-east-1 --secret-id 'operacionesagricolas/apk-firma' --query SecretString --output text | ConvertFrom-Json
$jks = Join-Path $env:TEMP "oa-firma-$([guid]::NewGuid()).jks"
[IO.File]::WriteAllBytes($jks, [Convert]::FromBase64String($firma.keystore_b64))
$env:OA_KEYSTORE = $jks; $env:OA_STORE_PASS = $firma.store_pass; $env:OA_KEY_ALIAS = $firma.key_alias; $env:OA_KEY_PASS = $firma.key_pass
Push-Location "$app\android"
try {
    .\gradlew.bat assembleRelease -q "-PversionCode=$codigo" "-PversionName=$nombre"
    if ($LASTEXITCODE) { throw 'Fallo gradle' }
} finally {
    Pop-Location
    Remove-Item $jks -Force -ErrorAction SilentlyContinue
    Remove-Item Env:OA_KEYSTORE, Env:OA_STORE_PASS, Env:OA_KEY_ALIAS, Env:OA_KEY_PASS -ErrorAction SilentlyContinue
}
$archivo = "TractorNintanga-$codigo.apk"
Copy-Item "$app\android\app\build\outputs\apk\release\app-release.apk" "$app\$archivo" -Force
Write-Host "APK firmado: $app\$archivo"
if ($SoloCompilar) { Write-Host 'Solo compilado (no se publico).'; exit 0 }

# 4. Publicar: primero el APK, al final version.json (asi nadie ve una version sin archivo)
aws s3 cp "$app\$archivo" "s3://$bucket/apk/$archivo" --profile $Perfil --content-type 'application/vnd.android.package-archive'
$meta = @{ version_code = $codigo; version_name = $nombre; archivo = $archivo; notas = $Notas; fecha = (Get-Date -Format s) } | ConvertTo-Json -Compress
$tmp = Join-Path $env:TEMP 'oa-version.json'
[IO.File]::WriteAllText($tmp, $meta, (New-Object Text.UTF8Encoding $false))
aws s3 cp $tmp "s3://$bucket/apk/version.json" --profile $Perfil --content-type 'application/json'
Remove-Item $tmp
Write-Host "Publicada la version $nombre. Primera instalacion: https://operacionesabk.miraigprovefrut.com/api/app-tablet/descargar"
