const Y = require('yjs');
const { encoding, decoding } = require('lib0');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');

const Scene = require('./models/Scene');
const { getPublisher, getSubscriber } = require('./redis');

const sceneDocs = new Map();
const sceneAwareness = new Map();
const REDIS_SYNC_CHANNEL_PREFIX = 'scene-sync:';
const REDIS_AWARENESS_CHANNEL_PREFIX = 'scene-awareness:';

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
    visible: true
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
    visible: true
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
    visible: true
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
    visible: true
  };

  root.children = [ambientId, dirId, cameraId];

  const nodes = new Map();
  nodes.set(rootId, root);
  nodes.set(ambientId, ambient);
  nodes.set(dirId, directional);
  nodes.set(cameraId, camera);

  return { rootNode: root, nodes };
}

function populateYDocFromScene(ydoc, sceneData) {
  const yNodes = ydoc.getMap('nodes');
  const yRootId = ydoc.getText('rootId');

  if (yRootId.toString() === '') {
    yRootId.insert(0, sceneData.rootNode.id);
  }

  if (!yNodes.get(sceneData.rootNode.id)) {
    yNodes.set(sceneData.rootNode.id, sceneData.rootNode);
  }

  sceneData.nodes.forEach((node, id) => {
    if (!yNodes.get(id)) {
      yNodes.set(id, node);
    }
  });
}

function sceneDocFromYDoc(ydoc) {
  const yNodes = ydoc.getMap('nodes');
  const rootId = ydoc.getText('rootId').toString();
  const rootNode = yNodes.get(rootId);

  const nodes = new Map();
  yNodes.forEach((node, id) => {
    nodes.set(id, node);
  });

  const yjsState = Y.encodeStateAsUpdate(ydoc);
  return { rootNode, nodes, yjsState };
}

async function loadOrCreateScene(sceneId) {
  if (sceneDocs.has(sceneId)) {
    return sceneDocs.get(sceneId);
  }

  let sceneDoc = await Scene.findOne({ sceneId });
  const ydoc = new Y.Doc();

  if (sceneDoc && sceneDoc.yjsState) {
    try {
      Y.applyUpdate(ydoc, sceneDoc.yjsState);
      console.log(`Scene ${sceneId} loaded from MongoDB (Yjs state)`);
    } catch (e) {
      console.error('Failed to apply Yjs state, creating default:', e);
      const defaultScene = createDefaultScene();
      populateYDocFromScene(ydoc, defaultScene);
    }
  } else {
    const defaultScene = createDefaultScene();
    populateYDocFromScene(ydoc, defaultScene);

    const sceneData = sceneDocFromYDoc(ydoc);
    sceneDoc = new Scene({
      sceneId,
      rootNode: sceneData.rootNode,
      nodes: sceneData.nodes,
      yjsState: sceneData.yjsState
    });
    await sceneDoc.save();
    console.log(`Scene ${sceneId} created`);
  }

  setupRedisSubscription(sceneId, ydoc);

  ydoc.on('update', (update, origin) => {
    if (origin !== 'redis') {
      const publisher = getPublisher();
      publisher.publish(REDIS_SYNC_CHANNEL_PREFIX + sceneId, JSON.stringify({
        type: 'sync-update',
        update: Array.from(update)
      }));
    }
    scheduleSave(sceneId, ydoc);
  });

  sceneDocs.set(sceneId, ydoc);

  const awareness = new awarenessProtocol.Awareness(ydoc);
  awareness.on('update', ({ added, updated, removed }, origin) => {
    if (origin !== 'redis') {
      const states = [];
      const changedClients = added.concat(updated).concat(removed);
      const encoder = encoding.createEncoder();
      awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients, encoder);
      const update = encoding.toUint8Array(encoder);
      const publisher = getPublisher();
      publisher.publish(REDIS_AWARENESS_CHANNEL_PREFIX + sceneId, JSON.stringify({
        type: 'awareness-update',
        update: Array.from(update)
      }));
    }
  });
  sceneAwareness.set(sceneId, awareness);

  return ydoc;
}

function getAwareness(sceneId) {
  return sceneAwareness.get(sceneId);
}

function setupRedisSubscription(sceneId, ydoc) {
  const subscriber = getSubscriber();
  const awareness = sceneAwareness.get(sceneId);

  subscriber.subscribe(REDIS_SYNC_CHANNEL_PREFIX + sceneId, (err) => {
    if (err) console.error('Redis subscribe error:', err);
  });

  subscriber.subscribe(REDIS_AWARENESS_CHANNEL_PREFIX + sceneId, (err) => {
    if (err) console.error('Redis subscribe error:', err);
  });

  subscriber.on('message', (channel, message) => {
    try {
      const data = JSON.parse(message);

      if (channel === REDIS_SYNC_CHANNEL_PREFIX + sceneId && data.type === 'sync-update') {
        const update = new Uint8Array(data.update);
        Y.applyUpdate(ydoc, update, 'redis');
      }

      if (channel === REDIS_AWARENESS_CHANNEL_PREFIX + sceneId && data.type === 'awareness-update') {
        const update = new Uint8Array(data.update);
        if (awareness) {
          const decoder = decoding.createDecoder(update);
          awarenessProtocol.applyAwarenessUpdate(awareness, decoder, 'redis');
        }
      }
    } catch (e) {
      console.error('Redis message parse error:', e);
    }
  });
}

const saveTimers = new Map();
function scheduleSave(sceneId, ydoc) {
  if (saveTimers.has(sceneId)) {
    clearTimeout(saveTimers.get(sceneId));
  }
  saveTimers.set(sceneId, setTimeout(() => {
    saveSceneToMongoDB(sceneId, ydoc);
    saveTimers.delete(sceneId);
  }, 5000));
}

async function saveSceneToMongoDB(sceneId, ydoc) {
  try {
    const sceneData = sceneDocFromYDoc(ydoc);
    await Scene.findOneAndUpdate(
      { sceneId },
      {
        rootNode: sceneData.rootNode,
        nodes: sceneData.nodes,
        yjsState: sceneData.yjsState,
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
  getAwareness,
  saveSceneToMongoDB
};
