#!/usr/bin/env python3
"""更新本地中文字形子集。需要 fontTools；仅在界面文案变化后运行。"""
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont

root = Path(__file__).resolve().parents[1]
text = ''.join(path.read_text() for path in (root / 'src').rglob('*')
               if path.suffix in {'.jsx', '.js', '.css'})
text += ''.join(chr(i) for i in range(32, 127))
for weight in (400, 500, 600, 700):
    source = root / f'node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-chinese-simplified-{weight}-normal.woff'
    font = TTFont(source)
    options = subset.Options()
    options.flavor = 'woff'
    tool = subset.Subsetter(options=options)
    tool.populate(text=text)
    tool.subset(font)
    output = root / f'public/assets/fonts/noto-sc-{weight}.woff'
    font.flavor = 'woff'
    font.save(output)
    print(f'{weight}: {output.stat().st_size:,} bytes')
