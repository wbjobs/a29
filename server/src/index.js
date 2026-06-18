require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const Y = require('yjs');
const { encoding, decoding } = require('lib0');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');

const { connectMongoDB } = require('./mongo');
const { loadOrCreateScene, getAwareness } = require('./sceneManager');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/scenes/:sceneId', async (req, res) => {
  try {
    const { sceneId } = req.params;
    const ydoc = await loadOrCreateScene(sceneId);
    const yNodes = ydoc.getMap('nodes');
    const rootId = ydoc.getText('rootId').toString();
    const rootNode = yNodes.get(rootId);
    const nodes = {};
    yNodes.forEach((val, key) => {
      nodes[key] = val;
    });
    res.json({ sceneId, rootNode, nodes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const messageSync = 0;
const messageAwareness = 1;
const messageQueryAwareness = 3;

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-scene', async ({ sceneId, userId, userName }) => {
    socket.join(sceneId);
    socket.data.sceneId = sceneId;
    socket.data.userId = userId;
    socket.data.userName = userName || 'Anonymous';

    const ydoc = await loadOrCreateScene(sceneId);
    const awareness = getAwareness(sceneId);

    awareness.setLocalStateField('user', {
      id: userId,
      name: userName || 'Anonymous',
      color: getRandomColor()
    });

    socket.on('message', (encoder) => {
      const decoder = decoding.createDecoder(encoder);
      const encoder2 = encoding.createEncoder();
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case messageSync: {
          encoding.writeVarUint(encoder2, messageSync);
          syncProtocol.readSyncMessage(decoder, encoder2, ydoc, socket.id);
          if (encoding.length(encoder2) > 1) {
            socket.send(encoding.toUint8Array(encoder2));
          }
          broadcastToRoomExceptSender(sceneId, socket.id, messageSync, encoder2, ydoc);
          break;
        }
        case messageAwareness: {
          awarenessProtocol.applyAwarenessUpdate(
            awareness,
            decoding.readVarUint8Array(decoder),
            socket
          );
          break;
        }
        case messageQueryAwareness: {
          const users = [];
          awareness.getStates().forEach((state, clientId) => {
            if (state && state.user) {
              users.push({ clientId, ...state.user });
            }
          });
          socket.emit('users-list', users);
          break;
        }
      }
    });

    awareness.on('change', () => {
      const users = [];
      awareness.getStates().forEach((state, clientId) => {
        if (state && state.user) {
          users.push({ clientId, ...state.user });
        }
      });
      io.to(sceneId).emit('users-list', users);
    });

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, ydoc);
    socket.send(encoding.toUint8Array(encoder));

    console.log(`User ${socket.data.userName} (${userId}) joined scene ${sceneId}`);
    io.to(sceneId).emit('user-joined', { userId, userName: socket.data.userName, socketId: socket.id });
  });

  socket.on('disconnect', () => {
    const sceneId = socket.data.sceneId;
    const userId = socket.data.userId;
    if (sceneId) {
      const awareness = getAwareness(sceneId);
      if (awareness) {
        awarenessProtocol.removeAwarenessStates(
          awareness,
          Array.from(awareness.getStates().keys()).filter(
            (clientId) => awareness.getStates().get(clientId)?.user?.id === userId
          ),
          socket
        );
      }
      io.to(sceneId).emit('user-left', { userId, socketId: socket.id });
      console.log(`User ${userId} disconnected from scene ${sceneId}`);
    }
  });
});

function broadcastToRoomExceptSender(sceneId, senderSocketId, messageType, encoder, ydoc) {
  if (encoding.length(encoder) <= 1) return;
  const data = encoding.toUint8Array(encoder);
  io.to(sceneId).sockets.forEach((socket) => {
    if (socket.id !== senderSocketId) {
      socket.send(data);
    }
  });
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

async function start() {
  const PORT = process.env.PORT || 3001;
  await connectMongoDB();
  server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
