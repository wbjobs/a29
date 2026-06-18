const { v4: uuidv4 } = require('uuid');
const SceneVersion = require('./models/SceneVersion');
const SceneBranch = require('./models/SceneBranch');
const Scene = require('./models/Scene');
const { serializeScene, deserializeScene } = require('./binarySerializer');

function generateCommitId() {
  return uuidv4().replace(/-/g, '').substring(0, 16);
}

async function ensureMainBranch(sceneId) {
  let mainBranch = await SceneBranch.findOne({ sceneId, branchName: 'main' });
  if (!mainBranch) {
    mainBranch = new SceneBranch({
      sceneId,
      branchName: 'main',
      currentCommitId: null
    });
    await mainBranch.save();
  }
  return mainBranch;
}

async function commitScene(sceneState, author, message = '') {
  const sceneId = sceneState.sceneId;
  await ensureMainBranch(sceneId);

  const currentBranch = await SceneBranch.findOne({ sceneId, branchName: sceneState.currentBranch || 'main' });
  if (!currentBranch) {
    throw new Error(`Branch ${sceneState.currentBranch || 'main'} not found`);
  }

  const sceneData = sceneState.getSceneData();
  const snapshot = serializeScene(sceneData);

  const commit = new SceneVersion({
    sceneId,
    commitId: generateCommitId(),
    parentCommitId: currentBranch.currentCommitId,
    branch: currentBranch.branchName,
    message,
    author,
    snapshot,
    snapshotSize: snapshot.length,
    nodeCount: sceneData.nodes ? Object.keys(sceneData.nodes).length : 0
  });

  await commit.save();

  currentBranch.currentCommitId = commit.commitId;
  currentBranch.updatedAt = new Date();
  await currentBranch.save();

  const sceneDoc = await Scene.findOne({ sceneId });
  if (sceneDoc) {
    sceneDoc.currentBranch = currentBranch.branchName;
    sceneDoc.currentCommitId = commit.commitId;
    await sceneDoc.save();
  }

  return {
    commitId: commit.commitId,
    message: commit.message,
    author: commit.author,
    createdAt: commit.createdAt,
    parentCommitId: commit.parentCommitId,
    branch: commit.branch,
    nodeCount: commit.nodeCount,
    snapshotSize: commit.snapshotSize
  };
}

async function listCommits(sceneId, branch = 'main', limit = 50) {
  const commits = await SceneVersion.find({ sceneId, branch })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('-snapshot');

  return commits;
}

async function listAllCommits(sceneId, limit = 100) {
  const commits = await SceneVersion.find({ sceneId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select('-snapshot');

  return commits;
}

async function getCommit(sceneId, commitId) {
  const commit = await SceneVersion.findOne({ sceneId, commitId });
  if (!commit) return null;
  return {
    ...commit.toObject(),
    sceneData: deserializeScene(commit.snapshot)
  };
}

async function checkoutCommit(sceneState, commitId) {
  const commit = await SceneVersion.findOne({ sceneId: sceneState.sceneId, commitId });
  if (!commit) {
    throw new Error(`Commit ${commitId} not found`);
  }

  const sceneData = deserializeScene(commit.snapshot);

  sceneState.nodes.clear();
  if (sceneData.nodes instanceof Map) {
    sceneData.nodes.forEach((node, id) => {
      sceneState.nodes.set(id, node);
    });
  } else {
    Object.keys(sceneData.nodes).forEach((id) => {
      sceneState.nodes.set(id, sceneData.nodes[id]);
    });
  }
  sceneState.rootId = sceneData.rootId;
  sceneState.version = sceneData.version || 0;

  return sceneData;
}

async function createBranch(sceneId, branchName, fromCommitId = null) {
  const existing = await SceneBranch.findOne({ sceneId, branchName });
  if (existing) {
    throw new Error(`Branch ${branchName} already exists`);
  }

  let commitId = fromCommitId;
  if (!commitId) {
    const mainBranch = await SceneBranch.findOne({ sceneId, branchName: 'main' });
    commitId = mainBranch?.currentCommitId;
  }

  const branch = new SceneBranch({
    sceneId,
    branchName,
    currentCommitId: commitId
  });
  await branch.save();

  return branch;
}

async function listBranches(sceneId) {
  await ensureMainBranch(sceneId);
  const branches = await SceneBranch.find({ sceneId }).sort({ createdAt: 1 });
  return branches;
}

async function switchBranch(sceneState, branchName) {
  const branch = await SceneBranch.findOne({ sceneId: sceneState.sceneId, branchName });
  if (!branch) {
    throw new Error(`Branch ${branchName} not found`);
  }

  if (branch.currentCommitId) {
    await checkoutCommit(sceneState, branch.currentCommitId);
  }

  sceneState.currentBranch = branchName;
  return branch;
}

function findNodeDiff(nodeA, nodeB) {
  const differences = [];

  if (!nodeA || !nodeB) {
    return [{ field: 'node', type: nodeA ? 'deleted' : 'added' }];
  }

  const transformFields = ['position', 'rotation', 'scale'];
  for (const field of transformFields) {
    const valA = nodeA[field];
    const valB = nodeB[field];
    if (valA && valB) {
      if (valA.x !== valB.x || valA.y !== valB.y || valA.z !== valB.z) {
        differences.push({ field, type: 'modified', oldValue: valA, newValue: valB });
      }
    }
  }

  if (JSON.stringify(nodeA.material) !== JSON.stringify(nodeB.material)) {
    differences.push({ field: 'material', type: 'modified', oldValue: nodeA.material, newValue: nodeB.material });
  }

  if (JSON.stringify(nodeA.light) !== JSON.stringify(nodeB.light)) {
    differences.push({ field: 'light', type: 'modified', oldValue: nodeA.light, newValue: nodeB.light });
  }

  if (nodeA.visible !== nodeB.visible) {
    differences.push({ field: 'visible', type: 'modified', oldValue: nodeA.visible, newValue: nodeB.visible });
  }

  if (nodeA.name !== nodeB.name) {
    differences.push({ field: 'name', type: 'modified', oldValue: nodeA.name, newValue: nodeB.name });
  }

  return differences;
}

async function detectConflicts(sceneId, sourceBranch, targetBranch) {
  const sourceBranchDoc = await SceneBranch.findOne({ sceneId, branchName: sourceBranch });
  const targetBranchDoc = await SceneBranch.findOne({ sceneId, branchName: targetBranch });

  if (!sourceBranchDoc || !targetBranchDoc) {
    throw new Error('Branch not found');
  }

  const sourceCommit = await SceneVersion.findOne({ sceneId, commitId: sourceBranchDoc.currentCommitId });
  const targetCommit = await SceneVersion.findOne({ sceneId, commitId: targetBranchDoc.currentCommitId });

  if (!sourceCommit || !targetCommit) {
    return { conflicts: [], canMerge: true };
  }

  const sourceData = deserializeScene(sourceCommit.snapshot);
  const targetData = deserializeScene(targetCommit.snapshot);

  const sourceNodes = new Map();
  if (sourceData.nodes instanceof Map) {
    sourceData.nodes.forEach((node, id) => sourceNodes.set(id, node));
  } else {
    Object.keys(sourceData.nodes).forEach((id) => sourceNodes.set(id, sourceData.nodes[id]));
  }

  const targetNodes = new Map();
  if (targetData.nodes instanceof Map) {
    targetData.nodes.forEach((node, id) => targetNodes.set(id, node));
  } else {
    Object.keys(targetData.nodes).forEach((id) => targetNodes.set(id, targetData.nodes[id]));
  }

  const conflicts = [];
  const allIds = new Set([...sourceNodes.keys(), ...targetNodes.keys()]);

  for (const id of allIds) {
    if (id === 'root') continue;
    const sourceNode = sourceNodes.get(id);
    const targetNode = targetNodes.get(id);

    if (sourceNode && targetNode && sourceNode.version !== targetNode.version) {
      const diff = findNodeDiff(sourceNode, targetNode);
      if (diff.length > 0) {
        conflicts.push({
          nodeId: id,
          nodeName: sourceNode?.name || targetNode?.name,
          differences: diff,
          sourceNode,
          targetNode
        });
      }
    }
  }

  return {
    conflicts,
    canMerge: conflicts.length === 0
  };
}

async function mergeBranch(sceneState, sourceBranch, targetBranch, resolutionStrategy = 'source', manualResolutions = {}) {
  const conflictResult = await detectConflicts(sceneState.sceneId, sourceBranch, targetBranch);

  if (conflictResult.conflicts.length > 0 && Object.keys(manualResolutions).length === 0 && resolutionStrategy !== 'source' && resolutionStrategy !== 'target') {
    return { success: false, conflicts: conflictResult.conflicts, needsResolution: true };
  }

  const sourceBranchDoc = await SceneBranch.findOne({ sceneId: sceneState.sceneId, branchName: sourceBranch });
  const sourceCommit = await SceneVersion.findOne({ sceneId: sceneState.sceneId, commitId: sourceBranchDoc.currentCommitId });
  const sourceData = deserializeScene(sourceCommit.snapshot);

  const targetBranchDoc = await SceneBranch.findOne({ sceneId: sceneState.sceneId, branchName: targetBranch });
  const targetCommit = await SceneVersion.findOne({ sceneId: sceneState.sceneId, commitId: targetBranchDoc.currentCommitId });
  const targetData = deserializeScene(targetCommit.snapshot);

  const mergedNodes = new Map();

  if (targetData.nodes instanceof Map) {
    targetData.nodes.forEach((node, id) => mergedNodes.set(id, { ...node }));
  } else {
    Object.keys(targetData.nodes).forEach((id) => mergedNodes.set(id, { ...targetData.nodes[id] }));
  }

  const sourceNodes = new Map();
  if (sourceData.nodes instanceof Map) {
    sourceData.nodes.forEach((node, id) => sourceNodes.set(id, node));
  } else {
    Object.keys(sourceData.nodes).forEach((id) => sourceNodes.set(id, sourceData.nodes[id]));
  }

  const resolvedConflicts = [];
  for (const conflict of conflictResult.conflicts) {
    const { nodeId, sourceNode, targetNode } = conflict;
    if (manualResolutions[nodeId]) {
      const resolution = manualResolutions[nodeId];
      if (resolution === 'source') {
        mergedNodes.set(nodeId, { ...sourceNode, version: Date.now() });
      } else if (resolution === 'target') {
      } else if (resolution.custom) {
        mergedNodes.set(nodeId, { ...resolution.custom, version: Date.now() });
      }
      resolvedConflicts.push({ nodeId, resolution: resolution });
    } else if (resolutionStrategy === 'source') {
      mergedNodes.set(nodeId, { ...sourceNode, version: Date.now() });
      resolvedConflicts.push({ nodeId, resolution: 'source' });
    }
  }

  sourceNodes.forEach((node, id) => {
    if (!mergedNodes.has(id)) {
      mergedNodes.set(id, { ...node });
    } else if (!conflictResult.conflicts.find(c => c.nodeId === id)) {
      const sourceVersion = node.version || 0;
      const targetVersion = mergedNodes.get(id).version || 0;
      if (sourceVersion > targetVersion) {
        mergedNodes.set(id, { ...node });
      }
    }
  });

  sceneState.nodes.clear();
  mergedNodes.forEach((node, id) => {
    sceneState.nodes.set(id, node);
  });
  sceneState.rootId = sourceData.rootId;

  return {
    success: true,
    resolvedConflicts,
    unresolvedConflicts: []
  };
}

async function deleteBranch(sceneId, branchName) {
  if (branchName === 'main') {
    throw new Error('Cannot delete main branch');
  }
  await SceneBranch.findOneAndDelete({ sceneId, branchName });
  return true;
}

module.exports = {
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
  deleteBranch,
  ensureMainBranch,
  generateCommitId
};
