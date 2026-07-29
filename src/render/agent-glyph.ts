/**
 * エージェント種別ごとのグリフ。
 *
 * すべて 24×24 の座標系で描き、呼び出し側が拡大してキー画像に埋め込む。
 * herdr が検出するエージェントは 19 種類あり全部に絵を用意しても見分けが
 * つかないので、よく使うものだけ形で表し、残りは頭 2 文字の字面で示す。
 */

/** グリフを描く座標系の一辺。 */
export const GLYPH_BOX = 24;

const CENTER = GLYPH_BOX / 2;

/** claude: Claude Code が端末に出す ✳ に合わせた 8 方向の光条。 */
function claudeGlyph(color: string): string {
  const spokes = [0, 45, 90, 135, 180, 225, 270, 315]
    .map((degrees) => {
      const radians = (degrees * Math.PI) / 180;
      const [dx, dy] = [Math.cos(radians), Math.sin(radians)];
      const inner = point(dx, dy, 3.2);
      const outer = point(dx, dy, 10.4);
      return `M${inner} L${outer}`;
    })
    .join(" ");
  return `<path d="${spokes}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`;
}

/** codex: 中心と 6 方向の粒からなる花形。 */
function codexGlyph(color: string): string {
  const petals = [0, 60, 120, 180, 240, 300]
    .map((degrees) => {
      const radians = (degrees * Math.PI) / 180;
      const [cx, cy] = coordinates(Math.cos(radians), Math.sin(radians), 6.9);
      return `<circle cx="${cx}" cy="${cy}" r="2.7" fill="${color}"/>`;
    })
    .join("");
  return `${petals}<circle cx="${CENTER}" cy="${CENTER}" r="2.9" fill="${color}"/>`;
}

/** gemini: 4 方向に尖った星。 */
function geminiGlyph(color: string): string {
  return `<path d="M12 1.6c1.1 5.6 3.7 8.2 9.3 9.3-5.6 1.1-8.2 3.7-9.3 9.3-1.1-5.6-3.7-8.2-9.3-9.3 5.6-1.1 8.2-3.7 9.3-9.3Z" fill="${color}"/>`;
}

/** cursor: 矢印カーソル。 */
function cursorGlyph(color: string): string {
  return `<path d="M4.74 1.22 19.92 12.66l-6.71.66 3.52 7.26-2.97 1.43-3.52-7.37-4.84 3.96Z" fill="${color}"/>`;
}

const GLYPHS: Record<string, (color: string) => string> = {
  claude: claudeGlyph,
  codex: codexGlyph,
  gemini: geminiGlyph,
  cursor: cursorGlyph,
};

/**
 * エージェント種別のグリフを返す。形を用意していない種別は頭 2 文字を大文字で描く
 * （`cline` と `claude` のように頭 1 文字では被るため 2 文字にする）。
 * 種別が検出できていない場合は疑問符。
 */
export function agentGlyph(agent: string | null, color: string): string {
  const key = (agent ?? "").toLowerCase();
  const glyph = GLYPHS[key];
  if (glyph !== undefined) {
    return glyph(color);
  }
  return lettermark(agent === null || agent === "" ? "?" : agent.slice(0, 2), color);
}

function lettermark(text: string, color: string): string {
  return `<text x="${CENTER}" y="${CENTER}" text-anchor="middle" dominant-baseline="central" font-family="Helvetica, Arial, sans-serif" font-size="13" font-weight="700" fill="${color}">${escapeXml(text.toUpperCase())}</text>`;
}

function coordinates(dx: number, dy: number, radius: number): [string, string] {
  return [round(CENTER + dx * radius), round(CENTER + dy * radius)];
}

function point(dx: number, dy: number, radius: number): string {
  const [x, y] = coordinates(dx, dy, radius);
  return `${x} ${y}`;
}

function round(value: number): string {
  return (Math.round(value * 100) / 100).toString();
}

function escapeXml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
