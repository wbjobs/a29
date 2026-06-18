require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const { connectMongoDB } = require('./mongo');
const { loadOrCreateScene, broadcastOp, transformOp, deepClone } = require('./sceneManager');
const {
  commitScene,
  listCommits,
  listAllCommits,
  getCommit,
  checkoutCommit,
  createBranch,
  listBranches,
  switchBranch,
  detectConflicts,
  mergeBranch,
  deleteBranch
} = require('./versionControl');
const { generate3DObject, validateCode, sanitizeCode } = require('./aiModeler');

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

// ==================== Version Control API ====================

app.post('/api/scenes/:sceneId/commits', async (req, res) => {
  try {
    const { sceneId } = req.params;
    const { message, userId, userName } = req.body;
    const sceneState = await loadOrCreateScene(sceneId);
    const result = await commitScene(sceneState, { userId, userName }, message);
    io.to(sceneId).emit('version-committed', result);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/scenes/:sceneId/commits', async (req, res) => {
  try {
    const { sceneId } = req.params;
    const { branch, limit } = req.query;
    const commits = await listCommits(sceneId, branch, parseInt(limit) || 50);
    res.json(commits);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/scenes/:sceneId/commits/:commitId', async (req, res) => {
  try {
    const { sceneId, commitId } = req.params;
    const commit = await getCommit(sceneId, commitId);
    if (!commit) {
      return res.status(404).json({ error: 'Commit not found' });
    }
    delete commit.snapshot;
    res.json(commit);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scenes/:sceneId/commits/:commitId/checkout', async (req, res) => {
  try {
    const { sceneId, commitId } = req.params;
    const sceneState = await loadOrCreateScene(sceneId);
    const sceneData = await checkoutCommit(sceneState, commitId);
    io.to(sceneId).emit('scene-state', sceneData);
    io.to(sceneId).emit('version-checked-out', { commitId });
    res.json({ success: true, commitId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/scenes/:sceneId/branches', async (req, res) => {
  try {
    const { sceneId } = req.params;
    const branches = await listBranches(sceneId);
    res.json(branches);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scenes/:sceneId/branches', async (req, res) => {
  try {
    const { sceneId } = req.params;
    const { branchName, fromCommitId } = req.body;
    const branch = await createBranch(sceneId, branchName, fromCommitId);
    res.json(branch);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scenes/:sceneId/branches/:branchName/switch', async (req, res) => {
  try {
    const { sceneId, branchName } = req.params;
    const sceneState = await loadOrCreateScene(sceneId);
    await switchBranch(sceneState, branchName);
    const sceneData = sceneState.getSceneData();
    io.to(sceneId).emit('scene-state', sceneData);
    io.to(sceneId).emit('branch-switched', { branchName });
    res.json({ success: true, branchName, sceneData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/scenes/:sceneId/branches/:sourceBranch/merge/:targetBranch/conflicts', async (req, res) => {
  try {
    const { sceneId, sourceBranch, targetBranch } = req.params;
    const conflicts = await detectConflicts(sceneId, sourceBranch, targetBranch);
    res.json(conflicts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/scenes/:sceneId/branches/:sourceBranch/merge/:targetBranch', async (req, res) => {
  try {
    const { sceneId, sourceBranch, targetBranch } = req.params;
    const { resolutionStrategy, manualResolutions } = req.body;
    const sceneState = await loadOrCreateScene(sceneId);
    const result = await mergeBranch(sceneState, sourceBranch, targetBranch, resolutionStrategy, manualResolutions);
    if (result.success) {
      const sceneData = sceneState.getSceneData();
      io.to(sceneId).emit('scene-state', sceneData);
      io.to(sceneId).emit('branches-merged', { sourceBranch, targetBranch, result });
    }
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/scenes/:sceneId/branches/:branchName', async (req, res) => {
  try {
    const { sceneId, branchName } = req.params;
    await deleteBranch(sceneId, branchName);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ==================== AI Modeler API ====================

app.post('/api/ai/generate', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt || prompt.trim().length === 0) {
      return res.status(400).json({ error: 'Prompt is required' });
    }
    const result = await generate3DObject(prompt);
    if (result.success) {
      const code = sanitizeCode(result.code);
      const valid = validateCode(code);
      res.json({
        success: true,
        code,
        valid,
        model: result.model
      });
    } else {
      res.status(500).json(result);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/ai/validate', async (req, res) => {
  try {
    const { code } = req.body;
    const valid = validateCode(code);
    res.json({ valid });
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
