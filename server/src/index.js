require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const { connectMongoDB } = require('./mongo');
const { loadOrCreateScene, broadcastOp, transformOp, deepClone } = require('./sceneManager');

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
    const sceneState = await loadOrCreateScene(sceneId);
    res.json(sceneState.getSceneData());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('join-scene', async ({ sceneId, userId, userName }) => {
    try {
      socket.join(sceneId);
      socket.data.sceneId = sceneId;
      socket.data.userId = userId;
      socket.data.userName = userName || 'Anonymous';

      const sceneState = await loadOrCreateScene(sceneId);

      const userInfo = {
        id: userId,
        name: userName || 'Anonymous',
        color: getRandomColor(),
        socketId: socket.id
      };
      sceneState.addUser(socket.id, userInfo);

      socket.emit('scene-state', sceneState.getSceneData());
      io.to(sceneId).emit('user-joined', userInfo);
      io.to(sceneId).emit('users-list', sceneState.getUsers());

      console.log(`User ${userName} (${userId}) joined scene ${sceneId}`);
    } catch (err) {
      console.error('join-scene error:', err);
    }
  });

  socket.on('operation', (op) => {
    const sceneId = socket.data.sceneId;
    if (!sceneId) return;

    loadOrCreateScene(sceneId).then((sceneState) => {
      op.opId = op.opId || uuidv4();
      op.userId = socket.data.userId;
      op.timestamp = op.timestamp || Date.now();

      const applied = sceneState.applyOperation(op);
      if (applied) {
        broadcastOp(sceneId, op, socket.id, io);
      }
    });
  });

  socket.on('undo', ({ opId }) => {
    console.log('Undo operation not fully implemented on server, handled by clients');
  });

  socket.on('redo', ({ opId }) => {
    console.log('Redo operation not fully implemented on server, handled by clients');
  });

  socket.on('request-users', () => {
    const sceneId = socket.data.sceneId;
    if (!sceneId) return;
    loadOrCreateScene(sceneId).then((sceneState) => {
      socket.emit('users-list', sceneState.getUsers());
    });
  });

  socket.on('disconnect', () => {
    const sceneId = socket.data.sceneId;
    const userId = socket.data.userId;
    if (sceneId) {
      loadOrCreateScene(sceneId).then((sceneState) => {
        sceneState.removeUser(socket.id);
        io.to(sceneId).emit('user-left', { userId, socketId: socket.id });
        io.to(sceneId).emit('users-list', sceneState.getUsers());
        console.log(`User ${userId} disconnected from scene ${sceneId}`);
      });
    }
  });
});

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
