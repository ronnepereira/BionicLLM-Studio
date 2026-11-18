param([Parameter(Mandatory = $true)][string]$Path)
$ErrorActionPreference = 'Stop'
$msiPath = (Resolve-Path -LiteralPath $Path).Path
$installer = New-Object -ComObject WindowsInstaller.Installer
$database = $installer.OpenDatabase($msiPath, 0)
$properties = @{}
$view = $database.OpenView('SELECT `Property`, `Value` FROM `Property`')
$view.Execute()
while ($record = $view.Fetch()) { $properties[$record.StringData(1)] = $record.StringData(2) }
$view.Close()
if ($properties['ProductName'] -ne 'BionicLLM Studio') { throw 'Unexpected MSI product name' }
if ($properties['UpgradeCode'].ToLower() -ne '{e14b61ae-b5ed-495b-b92e-9eb57a9b8018}') { throw 'MSI upgrade identity changed' }
$files = @()
$view = $database.OpenView('SELECT `FileName` FROM `File`')
$view.Execute()
while ($record = $view.Fetch()) { $files += ($record.StringData(1) -split '\|')[-1] }
$view.Close()
if (-not ($files -match '^BionicLLM Studio\.exe$')) { throw 'Application executable is missing' }
if (-not ($files -match '^bu-llama-server.*\.exe$')) { throw 'Inference engine sidecar is missing' }
if (-not ($files -match '^ggml-vulkan\.dll$')) { throw 'Vulkan companion is missing' }
if ($files -match '^\.env(?:\.|$)|\.key$|updater-password') { throw 'Private configuration was bundled' }
$stream = [System.IO.File]::OpenRead($msiPath)
try { $hash = [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($stream)).Replace('-', '').ToLower() }
finally { $stream.Dispose() }
[pscustomobject]@{
  Product = $properties['ProductName']
  Version = $properties['ProductVersion']
  Files = $files.Count
  Sha256 = $hash
  Path = $msiPath
} | ConvertTo-Json
