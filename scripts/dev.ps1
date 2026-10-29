# Run an npm command for the add-on inside node:22-alpine, so Node isn't needed on this PC.
# node_modules lives in a Docker volume to keep it out of OneDrive.
#   .\scripts\dev.ps1 install
#   .\scripts\dev.ps1 test
#   .\scripts\dev.ps1 run build
#   .\scripts\dev.ps1 serve      # offline mode on http://localhost:8099 using test fixtures
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$NpmArgs)

$addon = Join-Path $PSScriptRoot '..\zigbee_floorplan' | Resolve-Path
$common = @('--rm', '-v', "${addon}:/src", '-v', 'zigbee_floorplan_node_modules:/src/node_modules', '-w', '/src')

if ($NpmArgs.Count -eq 1 -and $NpmArgs[0] -eq 'serve') {
    docker run @common -it -p 8099:8099 -e FIXTURE_DIR=/src/test/fixtures -e DATA_DIR=/src/.data -e PORT=8099 `
        node:22-alpine sh -c 'npm run build && node dist/server/index.js'
} else {
    docker run @common node:22-alpine npm @NpmArgs
}
