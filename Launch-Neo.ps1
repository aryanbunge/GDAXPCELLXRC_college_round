$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

try {
    $neoSettings = Join-Path $env:LOCALAPPDATA 'Neo'
    $keyFile = Join-Path $neoSettings 'gemini-key.xml'
    $providerFile = Join-Path $neoSettings 'provider.txt'
    $secureKey = $null
    if (Test-Path -LiteralPath $keyFile) {
        try { $secureKey = Import-Clixml -LiteralPath $keyFile } catch { $secureKey = $null }
    }

    if ($secureKey -is [System.Security.SecureString]) {
        $apiKey = [System.Net.NetworkCredential]::new('', $secureKey).Password
        $env:GEMINI_API_KEY = $apiKey
        $env:NEO_AI_PROVIDER = 'gemini'
    }
    else {
        $savedProvider = if (Test-Path -LiteralPath $providerFile) {
            (Get-Content -LiteralPath $providerFile -Raw).Trim()
        } else { '' }
        if ($savedProvider -eq 'ollama') {
            $env:NEO_AI_PROVIDER = 'ollama'
        }
        else {
            $secureKey = Read-Host 'Gemini API key (press Enter to use local Ollama)' -AsSecureString
            $apiKey = [System.Net.NetworkCredential]::new('', $secureKey).Password
            if ($apiKey) {
                New-Item -ItemType Directory -Path $neoSettings -Force | Out-Null
                $secureKey | Export-Clixml -LiteralPath $keyFile
                Set-Content -LiteralPath $providerFile -Value 'gemini' -Encoding ascii
                $env:GEMINI_API_KEY = $apiKey
                $env:NEO_AI_PROVIDER = 'gemini'
            }
            else {
                New-Item -ItemType Directory -Path $neoSettings -Force | Out-Null
                Set-Content -LiteralPath $providerFile -Value 'ollama' -Encoding ascii
                Remove-Item Env:GEMINI_API_KEY -ErrorAction SilentlyContinue
                $env:NEO_AI_PROVIDER = 'ollama'
            }
        }
    }
    Remove-Variable apiKey -ErrorAction SilentlyContinue
    Remove-Variable secureKey -ErrorAction SilentlyContinue

    $condaCandidates = @(
        (Join-Path $env:USERPROFILE 'miniconda3\Scripts\conda.exe'),
        (Join-Path $env:USERPROFILE 'Miniconda3\Scripts\conda.exe'),
        (Join-Path $env:USERPROFILE 'anaconda3\Scripts\conda.exe')
    )
    $conda = $condaCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $conda) {
        $condaCommand = Get-Command conda.exe -ErrorAction SilentlyContinue
        if ($condaCommand) { $conda = $condaCommand.Source }
    }
    if (-not $conda) {
        throw 'Could not find Miniconda or Anaconda. Install it or update Launch-Neo.ps1 with its conda.exe path.'
    }

    Set-Location (Join-Path $projectRoot 'src')
    & $conda run --no-capture-output --name gest python .\Proton.py
    if ($LASTEXITCODE -ne 0) {
        Read-Host 'Neo closed with an error. Press Enter to close this window'
    }
}
catch {
    Write-Host "Neo could not start: $($_.Exception.Message)" -ForegroundColor Red
    Read-Host 'Press Enter to close this window'
}
