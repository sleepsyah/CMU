export function encodeNativeMessage(value) {
  const payload = Buffer.from(JSON.stringify(value), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

export function createNativeMessageDecoder(onMessage) {
  let buffered = Buffer.alloc(0);
  return (chunk) => {
    buffered = Buffer.concat([buffered, Buffer.from(chunk)]);
    while (buffered.length >= 4) {
      const length = buffered.readUInt32LE(0);
      if (length > 64 * 1024 * 1024) throw new Error("Native message exceeds Chrome's size limit.");
      if (buffered.length < length + 4) return;
      const payload = buffered.subarray(4, length + 4);
      buffered = buffered.subarray(length + 4);
      onMessage(JSON.parse(payload.toString("utf8")));
    }
  };
}
