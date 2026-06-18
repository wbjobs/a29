import { io } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function getRandomColor() {
  const colors = [
    '#ef4444', '#f97316', '#f59e0b', '#eab308',
    '#84cc16', '#22c55e', '#10b981', '#14b8a6',
    '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
    '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

export function createCollaboration(sceneId, userName = 'Anonymous') {
  const userId = uuidv4();
  const userColor = getRandomColor();
  const socket = io({ transports: ['websocket'] });

  const state = {
    nodes: new Map(),
    rootId: null,
    version: 0,
    users: [],
    connected: false
  };

  const history = {
    undoStack: [],
    redoStack: [],
    maxSize: 100
  };

  const listeners = new Set();
  let suppressHistory = false;

  function subscribe(callback) {
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  function notifyChange() {
    listeners.forEach((cb) => cb(state));
  }

  function getNode(id) {
    return state.nodes.get(id);
  }

  function setNode(id, node) {
    state.nodes.set(id, node);
  }

  function deleteNode(id) {
    state.nodes.delete(id);
  }

  function hasNode(id) {
    return state.nodes.has(id);
  }

  function forEachNode(callback) {
    state.nodes.forEach(callback);
  }

  function getNodesArray() {
    return Array.from(state.nodes.values());
  }

  function applyOpLocally(op, addToHistory = true) {
    suppressHistory = !addToHistory;
    let success = false;

    switch (op.type) {
      case 'add':
        success = applyAddOp(op);
        break;
      case 'remove':
        success = applyRemoveOp(op);
        break;
      case 'update':
        success = applyUpdateOp(op);
        break;
      default:
        break;
    }

    if (success && addToHistory) {
      history.undoStack.push(op);
      if (history.undoStack.length > history.maxSize) {
        history.undoStack.shift();
      }
      history.redoStack = [];
      state.version++;
    }

    suppressHistory = false;
    return success;
  }

  function applyAddOp(op) {
    if (state.nodes.has(op.node.id)) return false;
    const node = deepClone(op.node);
    state.nodes.set(node.id, node);

    if (node.parentId && state.nodes.has(node.parentId)) {
      const parent = state.nodes.get(node.parentId);
      if (!parent.children.includes(node.id)) {
        parent.children = [...(parent.children || []), node.id];
      }
    }

    return true;
  }

  function applyRemoveOp(op) {
    const node = state.nodes.get(op.nodeId);
    if (!node) return false;

    if (node.parentId && state.nodes.has(node.parentId)) {
      const parent = state.nodes.get(node.parentId);
      parent.children = (parent.children || []).filter((c) => c !== op.nodeId);
    }

    const removeChildren = (children) => {
      children.forEach((childId) => {
        const child = state.nodes.get(childId);
        if (child && child.children) removeChildren(child.children);
        state.nodes.delete(childId);
      });
    };
    if (node.children) removeChildren(node.children);

    state.nodes.delete(op.nodeId);
    return true;
  }

  function applyUpdateOp(op) {
    const node = state.nodes.get(op.nodeId);
    if (!node) return false;

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
    } else {
      node[op.path] = op.value;
    }

    node.version = (node.version || 0) + 1;
    return true;
  }

  function invertOp(op) {
    switch (op.type) {
      case 'add':
        return {
          ...op,
          type: 'remove',
          opId: uuidv4(),
          nodeId: op.node.id,
          previousNode: deepClone(op.node)
        };
      case 'remove':
        return {
          ...op,
          type: 'add',
          opId: uuidv4(),
          node: deepClone(op.previousNode || { id: op.nodeId })
        };
      case 'update':
        return {
          ...op,
          type: 'update',
          opId: uuidv4(),
          value: op.oldValue,
          oldValue: op.value
        };
      default:
        return null;
    }
  }

  function undo() {
    if (history.undoStack.length === 0) return null;
    const op = history.undoStack.pop();
    const inverseOp = invertOp(op);

    if (inverseOp) {
      const success = applyOpLocally(inverseOp, false);
      if (success) {
        history.redoStack.push(op);
        sendOp(inverseOp);
        return inverseOp;
      }
    }
    return null;
  }

  function redo() {
    if (history.redoStack.length === 0) return null;
    const op = history.redoStack.pop();
    const success = applyOpLocally(op, false);
    if (success) {
      history.undoStack.push(op);
      sendOp(op);
      return op;
    }
    return null;
  }

  function canUndo() {
    return history.undoStack.length > 0;
  }

  function canRedo() {
    return history.redoStack.length > 0;
  }

  function sendOp(op) {
    if (socket.connected) {
      socket.emit('operation', op);
    }
  }

  function createAddOp(node) {
    const op = {
      opId: uuidv4(),
      type: 'add',
      userId,
      timestamp: Date.now(),
      node: deepClone(node)
    };
    return op;
  }

  function createRemoveOp(nodeId, previousNode) {
    const op = {
      opId: uuidv4(),
      type: 'remove',
      userId,
      timestamp: Date.now(),
      nodeId,
      previousNode: previousNode ? deepClone(previousNode) : null
    };
    return op;
  }

  function createUpdateOp(nodeId, path, value, oldValue) {
    const op = {
      opId: uuidv4(),
      type: 'update',
      userId,
      timestamp: Date.now(),
      nodeId,
      path,
      value,
      oldValue: oldValue !== undefined ? oldValue : null
    };
    return op;
  }

  function addNode(node, addToHistory = true) {
    const op = createAddOp(node);
    const success = applyOpLocally(op, addToHistory);
    if (success) {
      sendOp(op);
      notifyChange();
    }
    return success ? node.id : null;
  }

  function removeNode(nodeId, addToHistory = true) {
    const node = state.nodes.get(nodeId);
    if (!node) return false;
    const op = createRemoveOp(nodeId, node);
    const success = applyOpLocally(op, addToHistory);
    if (success) {
      sendOp(op);
      notifyChange();
    }
    return success;
  }

  function updateNode(nodeId, path, value, addToHistory = true) {
    const node = state.nodes.get(nodeId);
    if (!node) return false;

    let oldValue;
    if (path === 'position' || path === 'rotation' || path === 'scale') {
      oldValue = { ...node[path] };
    } else if (path.startsWith('material.') || path.startsWith('light.') || path.startsWith('geometry.')) {
      const [category, field] = path.split('.');
      oldValue = node[category] ? node[category][field] : undefined;
    } else {
      oldValue = node[path];
    }

    const op = createUpdateOp(nodeId, path, value, oldValue);
    const success = applyOpLocally(op, addToHistory);
    if (success) {
      sendOp(op);
      notifyChange();
    }
    return success;
  }

  socket.on('connect', () => {
    state.connected = true;
    socket.emit('join-scene', { sceneId, userId, userName });
  });

  socket.on('disconnect', () => {
    state.connected = false;
  });

  socket.on('scene-state', (sceneData) => {
    state.rootId = sceneData.rootId;
    state.version = sceneData.version;
    state.nodes = new Map();

    if (sceneData.nodes) {
      Object.keys(sceneData.nodes).forEach((id) => {
        state.nodes.set(id, sceneData.nodes[id]);
      });
    }

    history.undoStack = [];
    history.redoStack = [];
    notifyChange();
  });

  socket.on('operation', (op) => {
    if (op.userId === userId) return;

    const success = applyOpLocally(op, false);
    if (success) {
      notifyChange();
    }
  });

  socket.on('users-list', (users) => {
    state.users = users;
    notifyChange();
  });

  socket.on('user-joined', (user) => {
    if (!state.users.find((u) => u.id === user.id)) {
      state.users.push(user);
      notifyChange();
    }
  });

  socket.on('user-left', ({ userId: leftUserId }) => {
    state.users = state.users.filter((u) => u.id !== leftUserId);
    notifyChange();
  });

  return {
    socket,
    userId,
    userColor,
    userName,
    state,
    history,
    subscribe,
    getNode,
    setNode,
    deleteNode,
    hasNode,
    forEachNode,
    getNodesArray,
    addNode,
    removeNode,
    updateNode,
    undo,
    redo,
    canUndo,
    canRedo,
    get rootId() {
      return state.rootId;
    },
    get nodes() {
      return state.nodes;
    },
    get users() {
      return state.users;
    },
    destroy() {
      socket.disconnect();
      listeners.clear();
    }
  };
}
