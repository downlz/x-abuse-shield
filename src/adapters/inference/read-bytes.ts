/**
 * Reads a model file into one buffer, reporting progress. Content-Length is
 * only a hint: it's the compressed size when the server, or Firefox reading a
 * packed .xpi, decompresses on the fly. So the buffer grows if the file turns
 * out larger, and is returned as a view when it ends up smaller.
 */
export async function readBytes(url: string, onProgress?: (percent: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Couldn't read the model (${response.status})`);
  const declared = Number(response.headers.get('content-length'));
  if (!response.body || !declared || !onProgress) return new Uint8Array(await response.arrayBuffer());

  let bytes = new Uint8Array(declared);
  let loaded = 0;
  const reader = response.body.getReader();
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    const needed = loaded + chunk.value.byteLength;
    if (needed > bytes.byteLength) {
      const grown = new Uint8Array(Math.max(Math.ceil(bytes.byteLength * 1.5), needed));
      grown.set(bytes.subarray(0, loaded));
      bytes = grown;
    }
    bytes.set(chunk.value, loaded);
    loaded = needed;
    onProgress(Math.min(99, Math.floor((loaded / declared) * 100)));
  }
  // A view, not a copy: the model is ~270 MB.
  return bytes.subarray(0, loaded);
}
