export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const MIME_EXTENSIONS: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
};

export function canonicalFile(file: {
  id: string;
  uploaded_by: string;
  course_id: string;
  storage_bucket: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
}): boolean {
  const ext = MIME_EXTENSIONS[file.mime_type];
  return (
    !!ext &&
    file.storage_bucket === 'learning-files' &&
    file.storage_path === `${file.uploaded_by}/${file.course_id}/${file.id}.${ext}` &&
    file.size_bytes > 0 &&
    file.size_bytes <= MAX_FILE_SIZE
  );
}

// Bounded structural screening, not a malware scan or full document parser.
export function validContent(bytes: Uint8Array, mime: string): boolean {
  if (!bytes.length || bytes.length > MAX_FILE_SIZE) return false;
  const ext = MIME_EXTENSIONS[mime];
  const decoder = new TextDecoder('utf-8', { fatal: true });
  if (ext === 'txt') {
    try {
      for (let i = 0; i < bytes.length; i += 65536) {
        const chunk = bytes.subarray(i, i + 65536);
        if (chunk.includes(0)) return false;
        decoder.decode(chunk, { stream: true });
      }
      decoder.decode();
      return true;
    } catch {
      return false;
    }
  }
  if (ext === 'pdf') {
    const ascii = new TextDecoder();
    return (
      /^%PDF-\d\.\d/.test(ascii.decode(bytes.subarray(0, 8))) &&
      ascii.decode(bytes.subarray(Math.max(0, bytes.length - 1024))).includes('%%EOF')
    );
  }
  if (ext !== 'docx' && ext !== 'pptx') return false;
  // Check the ZIP central directory and referenced local headers without expanding
  // attacker-controlled compressed data. ZIP64 and encrypted containers are rejected.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    let end = bytes.length - 22;
    const earliest = Math.max(0, end - 65535);
    while (end >= earliest && view.getUint32(end, true) !== 0x06054b50) end--;
    if (end < earliest || end + 22 + view.getUint16(end + 20, true) !== bytes.length) return false;
    if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) return false;
    const count = view.getUint16(end + 10, true);
    if (!count || count === 65535 || count > 10000 || count !== view.getUint16(end + 8, true))
      return false;
    const directorySize = view.getUint32(end + 12, true);
    const directoryStart = view.getUint32(end + 16, true);
    if (directoryStart + directorySize !== end) return false;
    let offset = directoryStart;
    let expanded = 0;
    const names = new Set<string>();
    for (let i = 0; i < count; i++) {
      if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) return false;
      if (view.getUint16(offset + 8, true) & 1) return false;
      const method = view.getUint16(offset + 10, true);
      if (method !== 0 && method !== 8) return false;
      const compressed = view.getUint32(offset + 20, true);
      expanded += view.getUint32(offset + 24, true);
      if (expanded > 100 * 1024 * 1024) return false;
      const length = view.getUint16(offset + 28, true);
      const nameBytes = bytes.subarray(offset + 46, offset + 46 + length);
      const name = decoder.decode(nameBytes);
      if (names.has(name) || name.includes('..') || name.startsWith('/') || name.includes('\\'))
        return false;
      names.add(name);
      const local = view.getUint32(offset + 42, true);
      if (local + 30 > directoryStart || view.getUint32(local, true) !== 0x04034b50) return false;
      const localLength = view.getUint16(local + 26, true);
      if (decoder.decode(bytes.subarray(local + 30, local + 30 + localLength)) !== name)
        return false;
      if (local + 30 + localLength + view.getUint16(local + 28, true) + compressed > directoryStart)
        return false;
      offset += 46 + length + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    }
    return (
      offset === end &&
      names.has('[Content_Types].xml') &&
      names.has('_rels/.rels') &&
      names.has(ext === 'docx' ? 'word/document.xml' : 'ppt/presentation.xml')
    );
  } catch {
    return false;
  }
}
