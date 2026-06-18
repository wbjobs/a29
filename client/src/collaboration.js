import * as Y from 'yjs';
import { io } from 'socket.io-client';
import { encoding, decoding } from 'lib0';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import { v4 as uuidv4 } from 'uuid';

const messageSync = 0;
const messageAwareness = 1;
const messageQueryAwareness = 3;

export function createCollaboration(sceneId, userName = 'Anonymous') {
  const ydoc = new Y.Doc();
  const userId = uuidv4();
  const awareness = new awarenessProtocol.Awareness(ydoc);

  awareness.setLocalStateField('user', {
    id: userId,
    name: userName,
    color: getRandomColor()
  });

  const socket = io({ transports: ['websocket'] });
  let connected = false;

  socket.on('connect', () => {
    connected = true;
    socket.emit('join-scene', { sceneId, userId, userName });
  });

  socket.on('disconnect', () => {
    connected = false;
  });

  socket.on('message', (data) => {
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(data);
    const messageType = decoding.readVarUint(decoder);

    switch (messageType) {
      case messageSync:
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, ydoc, socket);
        if (encoding.length(encoder) > 1) {
          socket.send(encoding.toUint8Array(encoder));
        }
        break;
      case messageAwareness:
        awarenessProtocol.applyAwarenessUpdate(
          awareness,
          decoding.readVarUint8Array(decoder),
          socket
        );
        break;
    }
  });

  ydoc.on('update', (update, origin) => {
    if (origin !== socket && connected) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      socket.send(encoding.toUint8Array(encoder));
    }
  });

  awareness.on('update', ({ added, updated, removed }, origin) => {
    const changedClients = added.concat(updated).concat(removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, changedClients)
    );
    socket.send(encoding.toUint8Array(encoder));
  });

  const yNodes = ydoc.getMap('nodes');
  const yRootId = ydoc.getText('rootId');

  return {
    ydoc,
    awareness,
    socket,
    yNodes,
    yRootId,
    userId,
    destroy() {
      awarenessProtocol.removeAwarenessStates(
        awareness,
        Array.from(awareness.getStates().keys()),
        socket
      );
      awareness.destroy();
      ydoc.destroy();
      socket.disconnect();
    }
  };
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
