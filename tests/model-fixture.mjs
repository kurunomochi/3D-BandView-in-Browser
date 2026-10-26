// A small, valid embedded glTF triangle for API regression tests.
export function triangleGlb(external = false) {
  const positions = new Float32Array([-1, 0, 0, 1, 0, 0, 0, 1, 0]);
  const json = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    buffers: [{ byteLength: positions.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [-1, 0, 0],
        max: [1, 1, 0],
      },
    ],
  };
  if (external) json.buffers[0].uri = "https://example.com/private.bin";
  let text = JSON.stringify(json);
  text += " ".repeat((4 - (Buffer.byteLength(text) % 4)) % 4);
  const data = Buffer.from(text),
    binary = Buffer.from(positions.buffer);
  const header = Buffer.alloc(20),
    chunk = Buffer.alloc(8);
  header.write("glTF");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + data.length + binary.length, 8);
  header.writeUInt32LE(data.length, 12);
  header.write("JSON", 16);
  chunk.writeUInt32LE(binary.length);
  chunk.write("BIN\0", 4);
  return Buffer.concat([header, data, chunk, binary]);
}
