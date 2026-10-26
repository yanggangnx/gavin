#!/usr/bin/env python3
"""Summarise the Xianyu sample: median, quartiles, and how it sits against the launch price.

Usage: python3 -I s5/tools/sample_stats.py
"""
import csv
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LAUNCH = 13998           # 国行官方定价，单机身
ODD = LAUNCH % 10000     # 抹掉“1万”后剩下的零头：3998

# Rough CPI chain from 2020 to 2026 (annual averages; 2026 = Jan–Sep vs same period of 2025).
# Used only to check the conclusion, never shown on screen. See evidence/ledger.csv L08.
CPI = {2021: 0.9, 2022: 2.0, 2023: 0.2, 2024: 0.2, 2025: 0.0, 2026: 0.9}

with open(ROOT / "evidence" / "xianyu-sample.csv", encoding="utf-8-sig") as f:
    rows = [r for r in csv.DictReader(f) if r["结论"] == "纳入"]
prices = sorted(float(r["挂牌价"]) for r in rows)

n = len(prices)
median = statistics.median(prices)
q1, _, q3 = statistics.quantiles(prices, n=4)  # method='exclusive'
below = sum(p < ODD for p in prices)
factor = 1.0
for pct in CPI.values():
    factor *= 1 + pct / 100

print(f"样本：{n} 条单机身挂牌价（搜索卡片上看不出国行还是水货）")
print(f"排序：{', '.join(f'{p:g}' for p in prices)}")
print(f"中位数：{median:g}    四分位（exclusive）：{q1:g} – {q3:g}    最低 {prices[0]:g} / 最高 {prices[-1]:g}")
print(f"均值：{statistics.mean(prices):.0f}")
print(f"中位数 / 官方定价：{median / LAUNCH:.1%}")
print(f"零头 {ODD}：中位数比它低 {ODD - median:g}；{n} 条里 {below} 条低于 {ODD}")
print(f"通胀自查：2020→2026 累计约 +{factor - 1:.1%}，官方定价折合 2026 年约 ¥{LAUNCH * factor:,.0f}，"
      f"中位数占 {median / (LAUNCH * factor):.1%}")
