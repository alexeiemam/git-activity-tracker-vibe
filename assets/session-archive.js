/** Portable, lossless session archives. Gzip is optional; the JSON payload is not altered. */
export const SESSION_ARCHIVE_EXTENSION = '.json.gz';
export const MAX_SESSION_JSON_BYTES = 1024 * 1024 * 1024;

const update = (onProgress, phase, value, message) => onProgress?.({phase, value, message});

/** Keep fallback JSON files importable when a browser lacks native compression. */
export async function encodeSessionArchive(payload, {onProgress, compress = true} = {}) {
  update(onProgress, 'Preparing session export', 8, 'Serialising the complete session off the main thread');
  const json = JSON.stringify(payload);
  if (typeof json !== 'string') throw new TypeError('Invalid session data for export.');
  const plain = new Blob([json], {type: 'application/json'});
  if (plain.size > MAX_SESSION_JSON_BYTES) throw new RangeError('Session JSON exceeds the browser export safety limit.');
  if (!compress || typeof CompressionStream !== 'function') {
    update(onProgress, 'Preparing session export', 98, 'Native gzip is unavailable; saving compatible JSON instead');
    return {blob: plain, compressed: false, originalBytes: plain.size};
  }
  update(onProgress, 'Compressing session', 40, 'Compressing Git history, identities and preferences using gzip');
  try {
    const stream = plain.stream().pipeThrough(new CompressionStream('gzip'));
    const blob = await new Response(stream, {headers: {'Content-Type': 'application/gzip'}}).blob();
    update(onProgress, 'Compressing session', 98, 'Compressed archive ready to save');
    return {blob, compressed: true, originalBytes: plain.size};
  } catch (error) {
    // A failed compressor must not make a user's full session impossible to save.
    update(onProgress, 'Preparing session export', 98, 'Compression failed; saving compatible JSON instead');
    return {blob: plain, compressed: false, originalBytes: plain.size, fallbackReason: error?.message || 'Compression failed'};
  }
}

async function readBoundedUtf8(stream, maxBytes) {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', {fatal: true});
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new RangeError(`Session exceeds the ${Math.max(1, Math.round(maxBytes / 1048576))} MiB safety limit after decompression.`);
      }
      chunks.push(decoder.decode(value, {stream: true}));
    }
    chunks.push(decoder.decode());
  } finally {
    reader.releaseLock();
  }
  return chunks.join('');
}

/** Sniff gzip magic bytes, not MIME type or file extension (which users can rename). */
export async function decodeSessionArchive(file, {onProgress, maxBytes = MAX_SESSION_JSON_BYTES} = {}) {
  if (!(file instanceof Blob)) throw new TypeError('Select a JSON or JSON.gz session file.');
  const name = String(file.name || 'session');
  update(onProgress, 'Opening session', 8, 'Checking the session archive format');
  const magic = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const compressed = magic[0] === 0x1f && magic[1] === 0x8b;
  if (!compressed && /\.gz$/i.test(name)) throw new Error('The selected .gz file is not a valid gzip archive.');
  if (compressed && typeof DecompressionStream !== 'function') {
    throw new Error('This browser cannot open gzip sessions. Use an up-to-date browser or decompress the file to .json first.');
  }
  if (!compressed && file.size > maxBytes) throw new RangeError('Session JSON exceeds the browser import safety limit.');
  update(onProgress, compressed ? 'Decompressing session' : 'Reading session', 25,
    compressed ? 'Unpacking the gzip archive locally' : 'Loading an existing JSON session');
  let text;
  try {
    const stream = compressed ? file.stream().pipeThrough(new DecompressionStream('gzip')) : file.stream();
    text = await readBoundedUtf8(stream, maxBytes);
  } catch (error) {
    if (error instanceof RangeError) throw error;
    throw new Error(compressed ? 'Could not decompress the session archive. It may be damaged or incomplete.'
      : 'Could not read the session file.');
  }
  update(onProgress, 'Restoring session', 85, 'Checking the JSON session contents');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The session is not valid JSON. Please select a git:signals session export.');
  }
}
