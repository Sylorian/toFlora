#!/usr/bin/env python3
"""按页面实际用到的字符，给手写体做子集。

用法：
    pip install fonttools brotli
    python tools/subset-font.py "C:/path/to/XiaoDouDao....ttf"

为什么需要这一步：原字体 3.5MB、4600+ 字；页面上的句子是固定的，
只用到其中约 500 个汉字 + ASCII，子集后只有 181KB。

改了 data/*.txt 之后如果出现了新字，重跑一次这个脚本就行；
不重跑也不会崩 —— 新字会退到楷体（--hand 里的 fallback）。
"""
import io, os, sys

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(SITE, "static", "fonts", "xiaodou-sea.woff2")

# 界面上写死的文案（改模板里的按钮/落款时记得同步这里）
UI = "to Flora Sylorian 献给 Flora 抽一颗流星 再抽一颗 重新排列星星 随机抽一颗流星"

def collect():
    chars = set(UI)
    for fn in ("presets.txt", "featured.txt", "birthday.txt"):
        p = os.path.join(SITE, "data", fn)
        if not os.path.exists(p):
            continue
        for line in io.open(p, encoding="utf-8"):
            s = line.strip()
            if s and not s.startswith("#"):
                chars |= set(s)
    chars |= set(chr(c) for c in range(0x20, 0x7F))          # ASCII
    chars |= set("，。、；：？！（）【】「」『』《》〈〉“”‘’…—·～￥％＃＆＊＋－／＝")
    chars |= set("０１２３４５６７８９")
    return {c for c in chars if c.isprintable()}

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    from fontTools.subset import main as subset_main
    chars = collect()
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    subset_main([
        sys.argv[1],
        "--text=" + "".join(sorted(chars)),
        "--flavor=woff2",
        "--layout-features=kern,liga",
        "--no-hinting",
        "--desubroutinize",
        "--drop-tables+=DSIG",
        "--name-IDs=1,2,3,4,6",
        "--output-file=" + OUT,
    ])
    print("字符数 %d → %s (%.1f KB)" % (len(chars), OUT, os.path.getsize(OUT) / 1024))

if __name__ == "__main__":
    main()
