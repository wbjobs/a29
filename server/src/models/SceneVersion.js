const mongoose = require('mongoose');

const SceneVersionSchema = new mongoose.Schema({
  sceneId: { type: String, required: true, index: true },
  commitId: { type: String, required: true, unique: true, index: true },
  parentCommitId: { type: String, default: null },
  branch: { type: String, required: true, default: 'main' },
  message: { type: String, default: '' },
  author: {
    userId: { type: String, required: true },
    userName: { type: String, required: true }
  },
  snapshot: {
    type: Buffer,
    required: true
  },
  snapshotSize: { type: Number, default: 0 },
  nodeCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SceneVersion', SceneVersionSchema);
