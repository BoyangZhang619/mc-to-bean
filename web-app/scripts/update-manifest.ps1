# update-manifest.ps1 — 重新生成 public/official/manifest.json
# 用法: 往 public/official/ 下新增/删除 JSON 后, 在 web-app 目录运行:
#   powershell -ExecutionPolicy Bypass -File scripts/update-manifest.ps1
# $categories 可按需增删分区 (键 = public/official 下相对路径, 值 = 分区显示名)

$basePath = "D:\gitLocal\mc-to-bean\web-app\public\official"
$manifest = [System.Collections.ArrayList]::new()

$categories = [ordered]@{
  "minecraft/textures/block"       = "Minecraft 方块"
  "minecraft/textures/item"        = "Minecraft 物品"
  "minecraft/textures/entity"      = "Minecraft 实体"
  "minecraft/textures/gui"         = "Minecraft GUI"
  "minecraft/textures/environment" = "Minecraft 环境"
  "minecraft/textures/effect"      = "Minecraft 效果"
  "minecraft/textures/font"        = "Minecraft 字体"
  "minecraft/textures/map"         = "Minecraft 地图"
  "minecraft/textures/misc"        = "Minecraft 杂项"
  "minecraft/textures/mob_effect"  = "Minecraft 状态效果"
  "minecraft/textures/painting"    = "Minecraft 画"
  "minecraft/textures/particle"    = "Minecraft 粒子"
  "minecraft/textures/trims"       = "Minecraft 纹饰"
  "fonts/illageralt"               = "花体符文"
}

$catEnumerator = $categories.GetEnumerator()
while ($catEnumerator.MoveNext()) {
  $catKey = $catEnumerator.Key
  $catLabel = $catEnumerator.Value
  $dir = Join-Path $basePath $catKey
  if (Test-Path $dir) {
    Get-ChildItem -Path $dir -Recurse -File -Filter "*.json" | ForEach-Object {
      $relPath = $_.FullName.Substring($basePath.Length + 1).Replace('\', '/')
      [void]$manifest.Add(@{ path = $relPath; name = $_.BaseName; category = $catKey; categoryLabel = $catLabel })
    }
  }
}

$json = ConvertTo-Json -InputObject $manifest -Depth 3 -Compress
$utf8 = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText((Join-Path $basePath "manifest.json"), $json, $utf8)
Write-Host "Done: $($manifest.Count) entries"
