const TYPE_MARKERS = {
  OBJECT: 0x01,
  ARRAY: 0x02,
  STRING: 0x03,
  INT32: 0x04,
  FLOAT64: 0x05,
  BOOLEAN: 0x06,
  NULL: 0x07,
  VEC3: 0x08,
  UNDEFINED: 0x09
};

function encodeString(str) {
  const strBytes = Buffer.from(str, 'utf8');
  const lenBuffer = Buffer.alloc(4);
  lenBuffer.writeUInt32LE(strBytes.length, 0);
  return Buffer.concat([lenBuffer, strBytes]);
}

function decodeString(buffer, offset) {
  const len = buffer.readUInt32LE(offset);
  offset += 4;
  const str = buffer.toString('utf8', offset, offset + len);
  offset += len;
  return { value: str, offset };
}

function encodeValue(value) {
  if (value === null) {
    return Buffer.from([TYPE_MARKERS.NULL]);
  }
  if (value === undefined) {
    return Buffer.from([TYPE_MARKERS.UNDEFINED]);
  }
  if (typeof value === 'boolean') {
    return Buffer.from([TYPE_MARKERS.BOOLEAN, value ? 0x01 : 0x00]);
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) {
      const buffer = Buffer.alloc(5);
      buffer[0] = TYPE_MARKERS.INT32;
      buffer.writeInt32LE(value, 1);
      return buffer;
    } else {
      const buffer = Buffer.alloc(9);
      buffer[0] = TYPE_MARKERS.FLOAT64;
      buffer.writeDoubleLE(value, 1);
      return buffer;
    }
  }
  if (typeof value === 'string') {
    return Buffer.concat([Buffer.from([TYPE_MARKERS.STRING]), encodeString(value)]);
  }
  if (Array.isArray(value)) {
    const parts = [Buffer.from([TYPE_MARKERS.ARRAY])];
    const lenBuffer = Buffer.alloc(4);
    lenBuffer.writeUInt32LE(value.length, 0);
    parts.push(lenBuffer);
    for (const item of value) {
      parts.push(encodeValue(item));
    }
    return Buffer.concat(parts);
  }
  if (typeof value === 'object') {
    if (value.x !== undefined && value.y !== undefined && value.z !== undefined &&
        typeof value.x === 'number' && typeof value.y === 'number' && typeof value.z === 'number') {
      const buffer = Buffer.alloc(25);
      buffer[0] = TYPE_MARKERS.VEC3;
      buffer.writeDoubleLE(value.x, 1);
      buffer.writeDoubleLE(value.y, 9);
      buffer.writeDoubleLE(value.z, 17);
      return buffer;
    }
    const parts = [Buffer.from([TYPE_MARKERS.OBJECT])];
    const keys = Object.keys(value);
    const lenBuffer = Buffer.alloc(4);
    lenBuffer.writeUInt32LE(keys.length, 0);
    parts.push(lenBuffer);
    for (const key of keys) {
      parts.push(encodeString(key));
      parts.push(encodeValue(value[key]));
    }
    return Buffer.concat(parts);
  }
  return Buffer.from([TYPE_MARKERS.NULL]);
}

function decodeValue(buffer, offset) {
  const type = buffer[offset];
  offset += 1;

  switch (type) {
    case TYPE_MARKERS.NULL:
      return { value: null, offset };
    case TYPE_MARKERS.UNDEFINED:
      return { value: undefined, offset };
    case TYPE_MARKERS.BOOLEAN:
      return { value: buffer[offset] === 0x01, offset: offset + 1 };
    case TYPE_MARKERS.INT32:
      return { value: buffer.readInt32LE(offset), offset: offset + 4 };
    case TYPE_MARKERS.FLOAT64:
      return { value: buffer.readDoubleLE(offset), offset: offset + 8 };
    case TYPE_MARKERS.STRING: {
      const result = decodeString(buffer, offset);
      return { value: result.value, offset: result.offset };
    }
    case TYPE_MARKERS.VEC3: {
      const x = buffer.readDoubleLE(offset);
      const y = buffer.readDoubleLE(offset + 8);
      const z = buffer.readDoubleLE(offset + 16);
      return { value: { x, y, z }, offset: offset + 24 };
    }
    case TYPE_MARKERS.ARRAY: {
      const len = buffer.readUInt32LE(offset);
      offset += 4;
      const arr = [];
      for (let i = 0; i < len; i++) {
        const result = decodeValue(buffer, offset);
        arr.push(result.value);
        offset = result.offset;
      }
      return { value: arr, offset };
    }
    case TYPE_MARKERS.OBJECT: {
      const len = buffer.readUInt32LE(offset);
      offset += 4;
      const obj = {};
      for (let i = 0; i < len; i++) {
        const keyResult = decodeString(buffer, offset);
        offset = keyResult.offset;
        const valResult = decodeValue(buffer, offset);
        obj[keyResult.value] = valResult.value;
        offset = valResult.offset;
      }
      return { value: obj, offset };
    }
    default:
      return { value: null, offset };
  }
}

function serializeScene(sceneData) {
  const data = {
    rootId: sceneData.rootId,
    rootNode: sceneData.rootNode,
    nodes: sceneData.nodes,
    version: sceneData.version
  };
  return encodeValue(data);
}

function deserializeScene(buffer) {
  const result = decodeValue(buffer, 0);
  return result.value;
}

function serializeNode(node) {
  return encodeValue(node);
}

function deserializeNode(buffer) {
  const result = decodeValue(buffer, 0);
  return result.value;
}

module.exports = {
  serializeScene,
  deserializeScene,
  serializeNode,
  deserializeNode
};
