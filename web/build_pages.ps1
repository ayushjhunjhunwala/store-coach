# Bundle the worker and assemble the Cloudflare Pages output, then deploy.
# Usage (from web/): ./build_pages.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
npx wrangler@4.166.0 deploy --dry-run --outdir .build | Out-Null
Remove-Item -Recurse -Force pages/dist -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force pages/dist | Out-Null
Copy-Item -Recurse public/* pages/dist/
Copy-Item .build/worker.js pages/dist/_worker.js
Set-Location pages
npx wrangler@4.166.0 pages deploy --project-name sutra-store-coach --branch main --commit-dirty=true
