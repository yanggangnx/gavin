#!/usr/bin/env bash
# 下载 Imaging Resource 上的 S5 官方产品图到 s5-model/ref/（不提交到仓库，见 .gitignore）
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p ref
B=https://old.imaging-resource.com/PRODS/panasonic-s5
for f in front back top_lens sides beauty_2 front_grip back_angle back_grip front_LCD weather_sealing IBIS; do
  curl -fsSL -A "Mozilla/5.0" "$B/ZPR-panasonic-s5-$f.jpg" -o "ref/ZPR-panasonic-s5-$f.jpg"
done
ls -la ref
