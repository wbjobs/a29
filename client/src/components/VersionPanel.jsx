import React, { useState, useEffect } from 'react';

export default function VersionPanel({ userId, userName, onClose }) {
  const [commits, setCommits] = useState([]);
  const [branches, setBranches] = useState([]);
  const [currentBranch, setCurrentBranch] = useState('main');
  const [commitMessage, setCommitMessage] = useState('');
  const [newBranchName, setNewBranchName] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [mergeSource, setMergeSource] = useState('');
  const [mergeTarget, setMergeTarget] = useState('main');
  const [conflicts, setConflicts] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('commits');
  const sceneId = window.location.hash.slice(1) || 'demo-scene';

  const loadCommits = async (branch = 'main') => {
    try {
      const res = await fetch(`/api/scenes/${sceneId}/commits?branch=${branch}`);
      const data = await res.json();
      setCommits(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load commits:', e);
      setCommits([]);
    }
  };

  const loadBranches = async () => {
    try {
      const res = await fetch(`/api/scenes/${sceneId}/branches`);
      const data = await res.json();
      setBranches(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('Failed to load branches:', e);
      setBranches([]);
    }
  };

  useEffect(() => {
    loadCommits(currentBranch);
    loadBranches();
  }, [sceneId, currentBranch]);

  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/commits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: commitMessage,
          userId,
          userName
        })
      });
      const data = await res.json();
      if (data.commitId) {
        setCommitMessage('');
        loadCommits(currentBranch);
      }
    } catch (e) {
      console.error('Commit failed:', e);
    }
    setIsLoading(false);
  };

  const handleCheckout = async (commitId) => {
    try {
      await fetch(`/api/scenes/${sceneId}/commits/${commitId}/checkout`, {
        method: 'POST'
      });
    } catch (e) {
      console.error('Checkout failed:', e);
    }
  };

  const handleCreateBranch = async () => {
    if (!newBranchName.trim()) return;
    setIsLoading(true);
    try {
      await fetch(`/api/scenes/${sceneId}/branches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchName: newBranchName })
      });
      setNewBranchName('');
      loadBranches();
    } catch (e) {
      console.error('Create branch failed:', e);
    }
    setIsLoading(false);
  };

  const handleSwitchBranch = async (branchName) => {
    setIsLoading(true);
    try {
      await fetch(`/api/scenes/${sceneId}/branches/${branchName}/switch`, {
        method: 'POST'
      });
      setCurrentBranch(branchName);
      setSelectedBranch('');
    } catch (e) {
      console.error('Switch branch failed:', e);
    }
    setIsLoading(false);
  };

  const handleDeleteBranch = async (branchName) => {
    if (branchName === 'main') return;
    if (!confirm(`Delete branch "${branchName}"?`)) return;
    try {
      await fetch(`/api/scenes/${sceneId}/branches/${branchName}`, {
        method: 'DELETE'
      });
      loadBranches();
    } catch (e) {
      console.error('Delete branch failed:', e);
    }
  };

  const handleCheckConflicts = async () => {
    if (!mergeSource || !mergeTarget) return;
    try {
      const res = await fetch(`/api/scenes/${sceneId}/branches/${mergeSource}/merge/${mergeTarget}/conflicts`);
      const data = await res.json();
      setConflicts(data);
    } catch (e) {
      console.error('Check conflicts failed:', e);
    }
  };

  const handleMerge = async () => {
    if (!mergeSource || !mergeTarget) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/scenes/${sceneId}/branches/${mergeSource}/merge/${mergeTarget}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolutionStrategy: 'source' })
      });
      const data = await res.json();
      if (data.success) {
        setConflicts(null);
        setMergeSource('');
        loadCommits(currentBranch);
      }
    } catch (e) {
      console.error('Merge failed:', e);
    }
    setIsLoading(false);
  };

  const formatDate = (date) => {
    if (!date) return '';
    return new Date(date).toLocaleString();
  };

  const formatCommitId = (id) => {
    return id ? id.substring(0, 8) : '';
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📦 Scene Version Control</h2>
          <button className="btn btn-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-tabs">
          <button
            className={`modal-tab ${activeTab === 'commits' ? 'active' : ''}`}
            onClick={() => setActiveTab('commits')}
          >
            Commits
          </button>
          <button
            className={`modal-tab ${activeTab === 'branches' ? 'active' : ''}`}
            onClick={() => setActiveTab('branches')}
          >
            Branches
          </button>
          <button
            className={`modal-tab ${activeTab === 'merge' ? 'active' : ''}`}
            onClick={() => setActiveTab('merge')}
          >
            Merge
          </button>
        </div>

        <div className="modal-body">
          {activeTab === 'commits' && (
            <>
              <div className="commit-input">
                <input
                  type="text"
                  placeholder="Commit message..."
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCommit()}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleCommit}
                  disabled={isLoading || !commitMessage.trim()}
                >
                  {isLoading ? '...' : '✓ Commit'}
                </button>
              </div>

              <div className="branch-selector">
                <label>Branch:</label>
                <select value={currentBranch} onChange={(e) => setCurrentBranch(e.target.value)}>
                  {branches.map((b) => (
                    <option key={b.branchName} value={b.branchName}>
                      {b.branchName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="commit-list">
                {commits.length === 0 ? (
                  <div className="empty-state">
                    <p>No commits yet.</p>
                    <p className="hint">Make changes and create your first commit!</p>
                  </div>
                ) : (
                  commits.map((commit) => (
                    <div key={commit.commitId} className="commit-item">
                      <div className="commit-header">
                        <span className="commit-hash">{formatCommitId(commit.commitId)}</span>
                        <span className="commit-branch">{commit.branch}</span>
                        <span className="commit-date">{formatDate(commit.createdAt)}</span>
                      </div>
                      <div className="commit-message">{commit.message}</div>
                      <div className="commit-footer">
                        <span className="commit-author">
                          <span className="user-dot" style={{ backgroundColor: '#6366f1' }} />
                          {commit.author?.userName || 'Unknown'}
                        </span>
                        <span className="commit-info">
                          {commit.nodeCount} objects · {Math.round(commit.snapshotSize / 1024)}KB
                        </span>
                        <button
                          className="btn btn-small"
                          onClick={() => handleCheckout(commit.commitId)}
                        >
                          ↩ Checkout
                        </button>
                      </div>
                      {commit.parentCommitId && (
                        <div className="commit-parent">
                          ↳ parent: {formatCommitId(commit.parentCommitId)}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </>
          )}

          {activeTab === 'branches' && (
            <>
              <div className="branch-input">
                <input
                  type="text"
                  placeholder="New branch name..."
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateBranch()}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleCreateBranch}
                  disabled={isLoading || !newBranchName.trim()}
                >
                  + Create Branch
                </button>
              </div>

              <div className="branch-list">
                {branches.map((branch) => (
                  <div
                    key={branch.branchName}
                    className={`branch-item ${branch.branchName === currentBranch ? 'current' : ''}`}
                  >
                    <span className="branch-icon">🌿</span>
                    <div className="branch-info">
                      <div className="branch-name">
                        {branch.branchName}
                        {branch.branchName === currentBranch && (
                          <span className="current-badge">current</span>
                        )}
                      </div>
                      <div className="branch-commit">
                        HEAD: {formatCommitId(branch.currentCommitId) || 'no commits'}
                      </div>
                    </div>
                    <div className="branch-actions">
                      {branch.branchName !== currentBranch && (
                        <button
                          className="btn btn-small"
                          onClick={() => handleSwitchBranch(branch.branchName)}
                        >
                          ↪ Switch
                        </button>
                      )}
                      {branch.branchName !== 'main' && (
                        <button
                          className="btn btn-small btn-danger"
                          onClick={() => handleDeleteBranch(branch.branchName)}
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {activeTab === 'merge' && (
            <>
              <div className="merge-selectors">
                <div>
                  <label>Source branch (merge from):</label>
                  <select value={mergeSource} onChange={(e) => {
                    setMergeSource(e.target.value);
                    setConflicts(null);
                  }}>
                    <option value="">Select...</option>
                    {branches.filter(b => b.branchName !== mergeTarget).map((b) => (
                      <option key={b.branchName} value={b.branchName}>
                        {b.branchName}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="merge-arrow">↓</div>
                <div>
                  <label>Target branch (merge into):</label>
                  <select value={mergeTarget} onChange={(e) => {
                    setMergeTarget(e.target.value);
                    setConflicts(null);
                  }}>
                    {branches.filter(b => b.branchName !== mergeSource).map((b) => (
                      <option key={b.branchName} value={b.branchName}>
                        {b.branchName}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="merge-actions">
                <button
                  className="btn"
                  onClick={handleCheckConflicts}
                  disabled={!mergeSource || !mergeTarget}
                >
                  🔍 Check Conflicts
                </button>
                {conflicts && !conflicts.needsResolution && (
                  <button
                    className="btn btn-primary"
                    onClick={handleMerge}
                    disabled={isLoading}
                  >
                    {isLoading ? '...' : '🔀 Merge'}
                  </button>
                )}
              </div>

              {conflicts && (
                <div className="conflicts-panel">
                  <h4>
                    {conflicts.conflicts?.length > 0
                      ? `⚠️ ${conflicts.conflicts.length} conflicts detected`
                      : '✅ No conflicts'}
                  </h4>
                  {conflicts.conflicts?.length > 0 && (
                    <div className="conflict-list">
                      {conflicts.conflicts.map((conflict, idx) => (
                        <div key={idx} className="conflict-item">
                          <div className="conflict-header">
                            <span className="conflict-object">{conflict.nodeName}</span>
                            <span className="conflict-id">[{conflict.nodeId.substring(0, 8)}]</span>
                          </div>
                          <div className="conflict-diffs">
                            {conflict.differences.map((diff, di) => (
                              <div key={di} className="conflict-diff">
                                <span className="diff-field">{diff.field}</span>
                                <span className="diff-type">{diff.type}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
