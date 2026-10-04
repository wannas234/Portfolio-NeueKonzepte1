import { canonicalFile, validContent } from './file-validation.ts';
const encode = (s: string) => new TextEncoder().encode(s);
function check(actual: boolean, expected: boolean) {
  if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
}

// Minimal stored ZIP fixture. Format screening deliberately does not decompress XML.
function officeZip(names: string[]): Uint8Array {
  const locals: number[] = [];
  const central: number[] = [];
  for (const name of names) {
    const bytes = encode(name);
    const data = encode('<xml/>');
    const offset = locals.length;
    const local = new Uint8Array(30);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, bytes.length, true);
    locals.push(...local, ...bytes, ...data);
    const entry = new Uint8Array(46);
    const cv = new DataView(entry.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, bytes.length, true);
    cv.setUint32(42, offset, true);
    central.push(...entry, ...bytes);
  }
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, names.length, true);
  ev.setUint16(10, names.length, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, locals.length, true);
  return new Uint8Array([...locals, ...central, ...end]);
}
Deno.test('Content screening rejects mislabeled, truncated and binary text files', () => {
  check(validContent(encode('%PDF-1.7\nexample\n%%EOF'), 'application/pdf'), true);
  check(validContent(encode('%PDF-1.7\ntruncated'), 'application/pdf'), false);
  check(validContent(encode('Hallo'), 'application/pdf'), false);
  check(validContent(encode('Grüße 👋'), 'text/plain'), true);
  check(validContent(new Uint8Array([0xff]), 'text/plain'), false);
  check(validContent(new Uint8Array([65, 0]), 'text/plain'), false);
  check(validContent(new Uint8Array(), 'text/plain'), false);
});
Deno.test('Office screening validates directory, document kind and bounded offsets', () => {
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const pptx = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  const zip = officeZip(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);
  check(validContent(zip, docx), true);
  check(validContent(zip, pptx), false);
  check(
    validContent(officeZip(['[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml']), pptx),
    true,
  );
  check(validContent(zip.subarray(0, zip.length - 1), docx), false);
  check(
    validContent(
      officeZip(['[Content_Types].xml', '_rels/.rels', 'word/document.xml', '../evil']),
      docx,
    ),
    false,
  );
  const corrupted = zip.slice();
  new DataView(corrupted.buffer).setUint32(corrupted.length - 6, 0xffffffff, true);
  check(validContent(corrupted, docx), false);
});
Deno.test('Privileged operations require a canonical path derived from identity', () => {
  const file = {
    id: 'file',
    uploaded_by: 'anna',
    course_id: 'course',
    storage_bucket: 'learning-files',
    storage_path: 'anna/course/file.pdf',
    mime_type: 'application/pdf',
    size_bytes: 10,
  };
  check(canonicalFile(file), true);
  check(canonicalFile({ ...file, storage_path: 'ben/course/file.pdf' }), false);
  check(canonicalFile({ ...file, storage_bucket: 'other' }), false);
  check(canonicalFile({ ...file, size_bytes: 52428801 }), false);
});
