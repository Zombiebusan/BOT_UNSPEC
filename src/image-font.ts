import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { create, type Font } from 'fontkit';

const require = createRequire(import.meta.url);
const xml = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);
let fonts: Promise<{ regular: Font[]; bold: Font[] }> | undefined;
async function bundledFonts() {
  return fonts ??= (async () => {
    const load = async (path: string): Promise<Font> => {
      const font = create(await readFile(path));
      if (!('layout' in font)) throw new Error('Font gambar tidak valid.');
      return font;
    };
    const [regular, bold, greek, greekBold] = await Promise.all([
      load(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff')),
      load(require.resolve('@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff')),
      load(require.resolve('@fontsource/noto-sans/files/noto-sans-greek-400-normal.woff')),
      load(require.resolve('@fontsource/noto-sans/files/noto-sans-greek-700-normal.woff')),
    ]);
    return { regular: [regular, greek], bold: [bold, greekBold] };
  })().catch(error => { fonts = undefined;throw error; });
}

// Rasterize outlines, not SVG <text>: production needs no OS fonts/fontconfig.
export async function outlineImageText(svg: string): Promise<string> {
  const loaded = await bundledFonts();
  return svg.replace(/<text\s+([^>]+)>([^<]*)<\/text>/g, (_whole, attributes: string, encoded: string) => {
    const attribute = (name: string): string => new RegExp('(?:^|\\s)'+name+'="([^"]*)"').exec(attributes)?.[1] ?? '';
    const label = encoded.replace(/&(amp|lt|gt|quot|apos);/g, (_entity, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name]!);
    const candidates = Number(attribute('font-weight')) >= 600 ? loaded.bold : loaded.regular;
    const size = Number(attribute('font-size')) || 16;
    const segments: { text: string; font: Font }[] = [];
    for (const char of label) {
      const font = candidates.find(font => font.hasGlyphForCodePoint(char.codePointAt(0)!));
      if (!font) throw new Error('Karakter gambar tidak didukung font bawaan.');
      const last = segments.at(-1);
      if (last?.font === font) last.text += char;else segments.push({ text: char, font });
    }
    let advance = 0;
    const paths: string[] = [];
    for (const segment of segments) {
      const run = segment.font.layout(segment.text), scale = size / segment.font.unitsPerEm;
      for (const [index, glyph] of run.glyphs.entries()) {
        const position = run.positions[index]!;
        const path = glyph.path.toSVG();
        if (path) paths.push(`<path d="${path}" transform="translate(${advance + position.xOffset * scale} ${-position.yOffset * scale}) scale(${scale} ${-scale})"/>`);
        advance += position.xAdvance * scale;
      }
    }
    const anchor = attribute('text-anchor');
    const x = Number(attribute('x')) - (anchor === 'end' ? advance : anchor === 'middle' ? advance / 2 : 0);
    return `<g aria-label="${xml(label)}" fill="${attribute('fill') || '#18364b'}" transform="translate(${x} ${Number(attribute('y'))})">${paths.join('')}</g>`;
  });
}
