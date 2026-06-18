const { v4: uuidv4 } = require('uuid');
const Scene = require('./models/Scene');
const { getPublisher, getSubscriber } = require('./redis');

const scenes = new Map();
const REDIS_OP_CHANNEL_PREFIX = 'scene-op:';
const REDIS_SYNC_CHANNEL_PREFIX = 'scene-sync:';

function createDefaultScene() {
  const rootId = 'root';
  const root = {
    id: rootId,
    type: 'group',
    name: 'Scene',
    parentId: null,
    children: [],
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    version: 0
  };

  const ambientId = 'default-ambient';
  const ambient = {
    id: ambientId,
    type: 'ambientLight',
    name: 'Ambient Light',
    parentId: rootId,
    children: [],
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    light: { color: '#ffffff', intensity: 0.5 },
    visible: true,
    version: 0
  };

  const dirId = 'default-directional';
  const directional = {
    id: dirId,
    type: 'directionalLight',
    name: 'Directional Light',
    parentId: rootId,
    children: [],
    position: { x: 5, y: 10, z: 7.5 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    light: { color: '#ffffff', intensity: 1, castShadow: true },
    visible: true,
    version: 0
  };

  const cameraId = 'default-camera';
  const camera = {
    id: cameraId,
    type: 'perspectiveCamera',
    name: 'Camera',
    parentId: rootId,
    children: [],
    position: { x: 0, y: 5, z: 10 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    camera: { fov: 50, near: 0.1, far: 2000 },
    visible: true,
    version: 0
  };

  root.children = [ambientId, dirId, cameraId];

  const nodes = new Map();
  nodes.set(rootId, root);
  nodes.set(ambientId, ambient);
  nodes.set(dirId, directional);
  nodes.set(cameraId, camera);

  return { rootId, rootNode: root, nodes, version: 0 };
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function applyOpToNode(node, op) {
  if (op.path === 'position' || op.path === 'rotation' || op.path === 'scale') {
    node[op.path] = { ...node[op.path], ...op.value };
  } else if (op.path.startsWith('material.') || op.path.startsWith('light.') || op.path.startsWith('geometry.')) {
    const [category, field] = op.path.split('.');
    if (!node[category]) node[category] = {};
    node[category][field] = op.value;
  } else if (op.path === 'name' || op.path === 'visible') {
    node[op.path] = op.value;
  } else if (op.path === 'material') {
    node.material = { ...node.material, ...op.value };
  } else if (op.path === 'light') {
    node.light = { ...node.light, ...op.value };
  }
  node.version = (node.version || 0) + 1;
  return node;
}

function transformOp(op, concurrentOp) {
  if (op.opId === concurrentOp.opId) return null;
  if (op.nodeId !== concurrentOp.nodeId) return op;
  if (op.type !== 'update' || concurrentOp.type !== 'update') return op;
  if (op.path !== concurrentOp.path) return op;

  if (op.timestamp < concurrentOp.timestamp ||
      (op.timestamp === concurrentOp.timestamp && op.userId < concurrentOp.userId)) {
    return op;
  }
  return null;
}

class SceneState {
  constructor(sceneId) {
    this.sceneId = sceneId;
    this.nodes = new Map();
    this.rootId = null;
    this.version = 0;
    this.opHistory = [];
    this.connectedUsers = new Map();
  }

  loadFromMongo(sceneDoc) {
    if (sceneDoc.rootNode) {
      this.rootId = sceneDoc.rootNode.id;
    }
    if (sceneDoc.nodes) {
      if (sceneDoc.nodes instanceof Map) {
        this.nodes = new Map(sceneDoc.nodes);
      } else {
        this.nodes = new Map();
        Object.keys(sceneDoc.nodes).forEach((key) => {
          this.nodes.set(key, sceneDoc.nodes[key]);
        });
      }
    }
    this.version = sceneDoc.version || 0;
  }

  getSceneData() {
    const nodes = {};
    this.nodes.forEach((node, id) => {
      nodes[id] = node;
    });
    return {
      rootId: this.rootId,
      rootNode: this.nodes.get(this.rootId),
      nodes,
      version: this.version
    };
  }

  applyOperation(op) {
    switch (op.type) {
      case 'add':
        return this.applyAddOp(op);
      case 'remove':
        return this.applyRemoveOp(op);
      case 'update':
        return this.applyUpdateOp(op);
      default:
        return false;
    }
  }

  applyAddOp(op) {
    if (this.nodes.has(op.node.id)) return false;
    const node = deepClone(op.node);
    node.version = 0;
    this.nodes.set(node.id, node);

    if (node.parentId && this.nodes.has(node.parentId)) {
      const parent = this.nodes.get(node.parentId);
      if (!parent.children.includes(node.id)) {
        parent.children = [...(parent.children || []), node.id];
        parent.version = (parent.version || 0) + 1;
      }
    }

    this.version++;
    this.opHistory.push(op);
    if (this.opHistory.length > 1000) this.opHistory.shift();
    return true;
  }

  applyRemoveOp(op) {
    const node = this.nodes.get(op.nodeId);
    if (!node) return false;

    if (node.parentId && this.nodes.has(node.parentId)) {
      const parent = this.nodes.get(node.parentId);
      parent.children = (parent.children || []).filter((c) => c !== op.nodeId);
      parent.version = (parent.version || 0) + 1;
    }

    const removeChildren = (children) => {
      children.forEach((childId) => {
        const child = this.nodes.get(childId);
        if (child && child.children) removeChildren(child.children);
        this.nodes.delete(childId);
      });
    };
    if (node.children) removeChildren(node.children);

    this.nodes.delete(op.nodeId);
    this.version++;
    this.opHistory.push(op);
    if (this.opHistory.length > 1000) this.opHistory.shift();
    return true;
  }

  applyUpdateOp(op) {
    const node = this.nodes.get(op.nodeId);
    if (!node) return false;
    applyOpToNode(node, op);
    this.version++;
    this.opHistory.push(op);
    if (this.opHistory.length > 1000) this.opHistory.shift();
    return true;
  }

  addUser(socketId, userInfo) {
    this.connectedUsers.set(socketId, userInfo);
  }

  removeUser(socketId) {
    this.connectedUsers.delete(socketId);
  }

  getUsers() {
    return Array.from(this.connectedUsers.values());
  }
}

async function loadOrCreateScene(sceneId) {
  if (scenes.has(sceneId)) {
    return scenes.get(sceneId);
  }

  const sceneState = new SceneState(sceneId);
  let sceneDoc = await Scene.findOne({ sceneId });

  if (sceneDoc) {
    sceneState.loadFromMongo(sceneDoc);
    console.log(`Scene ${sceneId} loaded from MongoDB`);
  } else {
    const defaultScene = createDefaultScene();
    sceneState.rootId = defaultScene.rootId;
    sceneState.nodes = defaultScene.nodes;
    sceneState.version = defaultScene.version;

    const sceneData = sceneState.getSceneData();
    sceneDoc = new Scene({
      sceneId,
      name: 'Untitled Scene',
      rootNode: sceneData.rootNode,
      nodes: sceneData.nodes
    });
    await sceneDoc.save();
    console.log(`Scene ${sceneId} created`);
  }

  setupRedisSubscription(sceneId, sceneState);
  scenes.set(sceneId, sceneState);
  return sceneState;
}

function setupRedisSubscription(sceneId, sceneState) {
  const subscriber = getSubscriber();

  subscriber.subscribe(REDIS_OP_CHANNEL_PREFIX + sceneId, (err) => {
    if (err) console.error('Redis subscribe error:', err);
  });

  subscriber.on('message', (channel, message) => {
    if (channel !== REDIS_OP_CHANNEL_PREFIX + sceneId) return;
    try {
      const data = JSON.parse(message);
      if (data.originServerId === getServerId()) return;

      const applied = sceneState.applyOperation(data.op);
      if (applied) {
        scheduleSave(sceneId);
      }
    } catch (e) {
      console.error('Redis op parse error:', e);
    }
  });
}

let serverId = null;
function getServerId() {
  if (!serverId) {
    serverId = uuidv4();
  }
  return serverId;
}

function broadcastOp(sceneId, op, originSocketId, io) {
  const publisher = getPublisher();
  publisher.publish(REDIS_OP_CHANNEL_PREFIX + sceneId, JSON.stringify({
    op,
    originServerId: getServerId()
  }));

  if (io && originSocketId) {
    io.to(sceneId).except(originSocketId).emit('operation', op);
  }
}

const saveTimers = new Map();
function scheduleSave(sceneId) {
  if (saveTimers.has(sceneId)) {
    clearTimeout(saveTimers.get(sceneId));
  }
  saveTimers.set(sceneId, setTimeout(() => {
    saveSceneToMongoDB(sceneId);
    saveTimers.delete(sceneId);
  }, 5000));
}

async function saveSceneToMongoDB(sceneId) {
  try {
    const sceneState = scenes.get(sceneId);
    if (!sceneState) return;
    const sceneData = sceneState.getSceneData();
    await Scene.findOneAndUpdate(
      { sceneId },
      {
        rootNode: sceneData.rootNode,
        nodes: sceneData.nodes,
        updatedAt: new Date()
      },
      { upsert: true, new: true }
    );
    console.log(`Scene ${sceneId} saved to MongoDB`);
  } catch (e) {
    console.error('Failed to save scene:', e);
  }
}

module.exports = {
  loadOrCreateScene,
  broadcastOp,
  saveSceneToMongoDB,
  transformOp,
  deepClone
};
