$ErrorActionPreference = "Stop"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js is required. Install via https://nodejs.org/ or nvm for Windows."
  exit 1
}

if (-not (Test-Path -Path "node_modules")) {
  Write-Host "Installing dependencies..."
  npm install
}

Write-Host "Starting C64 Commander dev server..."
npm run dev
