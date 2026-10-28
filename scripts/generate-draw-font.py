import base64
import hashlib
import io
import json
from pathlib import Path

from fontTools.ttLib import TTFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/fonts/noto-sans/NotoSans-Regular.ttf'
font = TTFont(SOURCE, recalcTimestamp=False)
glyphs = {}
for codepoint, name in sorted(font.getBestCmap().items()):
    glyph = font['glyf'][name]
    advance, _bearing = font['hmtx'].metrics[name]
    glyphs[codepoint] = [advance, getattr(glyph, 'xMin', 0), getattr(glyph, 'xMax', 0)]

metadata = {
    'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    'unitsPerEm': font['head'].unitsPerEm,
    'glyphCount': len(glyphs),
    'ascent': max(getattr(font['glyf'][name], 'yMax', 0) for name in font.getBestCmap().values()),
    'descent': -min(getattr(font['glyf'][name], 'yMin', 0) for name in font.getBestCmap().values()),
}
metrics = 'export const DRAW_FONT_METRICS = ' + json.dumps(metadata, indent=2) + ' as const\n\n'
metrics += 'export const DRAW_FONT_GLYPHS: Readonly<Record<number, readonly [number, number, number]>> = {\n'
metrics += ',\n'.join(f'  {codepoint}: {json.dumps(value)}' for codepoint, value in glyphs.items()) + '\n}\n'
(ROOT / 'src/shared/drawFontMetrics.ts').write_text(metrics)

font.flavor = 'woff'
output = io.BytesIO()
font.save(output, reorderTables=False)
encoded = base64.b64encode(output.getvalue()).decode('ascii')
css = '@font-face{font-family:"Flowchart Diagram Sans";src:url(data:font/woff;base64,' + encoded + ') format("woff");font-weight:400;font-style:normal;font-display:block}'
(ROOT / 'src/utils/drawFontFace.ts').write_text('export const DRAW_FONT_FACE_CSS = ' + json.dumps(css) + '\n')
print(json.dumps({**metadata, 'woffBytes': len(output.getvalue()), 'woffSha256': hashlib.sha256(output.getvalue()).hexdigest()}, indent=2))
