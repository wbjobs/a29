const mongoose = require('mongoose');

const SceneBranchSchema = new mongoose.Schema({
  sceneId: { type: String, required: true, index: true },
  branchName: { type: String, required: true },
  currentCommitId: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

SceneBranchSchema.index({ sceneId: 1, branchName: 1 }, { unique: true });

module.exports = mongoose.model('SceneBranch', SceneBranchSchema);
