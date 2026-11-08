// Minimal ZIP (store, no compression) writer and reader.
const Zip = (() => {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  // files: [{ name, data: Blob }] -> Blob
  async function create(files) {
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const bytes = new Uint8Array(await f.data.arrayBuffer());
      const name = new TextEncoder().encode(f.name);
      const crc = crc32(bytes);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, bytes.length, true);
      local.setUint32(22, bytes.length, true);
      local.setUint16(26, name.length, true);
      parts.push(local, name, bytes);

      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, bytes.length, true);
      c.setUint32(24, bytes.length, true);
      c.setUint16(28, name.length, true);
      c.setUint32(42, offset, true);
      central.push(c, name);
      offset += 30 + name.length + bytes.length;
    }
    const centralSize = central.reduce((s, p) => s + p.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/zip' });
  }

  // Blob -> Map(name -> Blob). Only reads uncompressed entries.
  async function read(blob) {
    const tail = new DataView(await blob.slice(-22).arrayBuffer());
    if (tail.getUint32(0, true) !== 0x06054b50) throw new Error('Not a backup zip');
    const count = tail.getUint16(10, true);
    const cdSize = tail.getUint32(12, true);
    const cdOffset = tail.getUint32(16, true);
    const cd = new DataView(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
    const out = new Map();
    let p = 0;
    for (let i = 0; i < count; i++) {
      const method = cd.getUint16(p + 10, true);
      const size = cd.getUint32(p + 20, true);
      const nameLen = cd.getUint16(p + 28, true);
      const extraLen = cd.getUint16(p + 30, true);
      const commentLen = cd.getUint16(p + 32, true);
      const localOffset = cd.getUint32(p + 42, true);
      const name = new TextDecoder().decode(new Uint8Array(cd.buffer, p + 46, nameLen));
      if (method !== 0) throw new Error('Compressed zip not supported');
      const lh = new DataView(await blob.slice(localOffset, localOffset + 30).arrayBuffer());
      const start = localOffset + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
      out.set(name, blob.slice(start, start + size));
      p += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  return { create, read };
})();
