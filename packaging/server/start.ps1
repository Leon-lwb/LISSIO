$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigDir = if ($env:LISSIO_CONFIG_DIR) { $env:LISSIO_CONFIG_DIR } else { Join-Path $ScriptDir 'data' }
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null
& (Join-Path $ScriptDir 'lissio-server.exe') --config-dir $ConfigDir @args
exit $LASTEXITCODE
