import {
  pageReasons,
  pageGraphics,
  type PositionedText,
  type PageGraphics,
} from './document-layout.ts';
const assert = (v: unknown, m = 'Assertion failed') => {
  if (!v) throw new Error(m);
};
const item = (str: string, x = 30, y = 400, height = 12): PositionedText => ({
  str,
  transform: [height, 0, 0, height, x, y],
  width: (str.length * height) / 2,
  height,
  fontName: 'sans',
});
const graphics: PageGraphics = {
  imageArea: 0,
  bodyImageArea: 0,
  vectorShapes: 0,
  vectorArea: 0,
  unknownImages: false,
};
Deno.test(
  'Lines, backgrounds, underlines, marginal logos and fragmented URLs are not sufficient',
  () => {
    const g = pageGraphics(
      ['constructPath', 'constructPath', 'save', 'transform', 'paintImageXObject', 'restore'],
      [
        [23, [], [0, 0, 600, 800]],
        [20, [], [20, 400, 500, 401]],
        [],
        [30, 0, 0, 15, 20, 780],
        ['logo', 30, 15],
        [],
      ],
      [0, 0, 600, 800],
    );
    assert(g.vectorShapes === 0 && g.bodyImageArea === 0);
    assert(
      pageReasons([item('https://example.org?q=1')], ['constructPath'], { role: 'Figure' }, g)
        .length === 0,
    );
    assert(
      pageReasons([item('Title', 20, 700), item('prose', 20, 400)], ['stroke'], null, graphics)
        .length === 0,
    );
  },
);
Deno.test(
  'Scan with native heading, diagram with rich text, columns and mathematical scripts stay visual',
  () => {
    assert(
      pageReasons([item('Heading')], [], null, {
        ...graphics,
        imageArea: 0.6,
        bodyImageArea: 0.6,
      }).includes('large_image_or_scan'),
    );
    assert(
      pageReasons([item('Prose '.repeat(100))], [], null, {
        ...graphics,
        vectorShapes: 8,
        vectorArea: 0.1,
      }).includes('diagram_geometry'),
    );
    const columns = [0, 1, 2].flatMap((i) => [
      item('Left', 20, 400 - i * 20),
      item('Right', 300, 400 - i * 20),
    ]);
    assert(pageReasons(columns, [], null, graphics).includes('repeated_columns'));
    assert(
      pageReasons([item('P', 20, 400, 12), item('max', 26, 395, 7)], [], null, graphics).includes(
        'script_geometry',
      ),
    );
    assert(pageReasons([item('x = y^2')], [], null, graphics).includes('formula_candidate'));
  },
);

Deno.test('Small vector logos at the page margin do not independently trigger visual work', () => {
  const names = Array(5).fill('constructPath');
  const args = Array.from({ length: 5 }, (_, i) => [23, [], [20 + i, 10, 100 + i, 40]]);
  const g = pageGraphics(names, args, [0, 0, 600, 800]);
  assert(g.vectorShapes === 0);
  assert(pageReasons([item('Readable native prose')], names, { role: 'Figure' }, g).length === 0);
});
