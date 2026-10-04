// Small valid PDFs generated in tests; no copyrighted external fixtures.
export function pdfFixture(
  texts: string[],
  compress?: (data: Uint8Array) => Uint8Array,
  drawings: string[] = [],
): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${texts.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${texts.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  for (const [index, text] of texts.entries()) {
    const raw =
      (text ? `BT /F1 12 Tf 40 700 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET` : '') +
      (drawings[index] ?? '');
    const stream = compress
      ? Array.from(compress(new TextEncoder().encode(raw)), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('') + '>'
      : raw;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length + 2} 0 R >>`,
    );
    objects.push(
      `<< /Length ${stream.length} ${compress ? '/Filter [/ASCIIHexDecode /FlateDecode]' : ''} >>\nstream\n${stream}\nendstream`,
    );
  }
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
