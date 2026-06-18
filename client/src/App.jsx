import React, { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { createCollaboration } from './collaboration.js';
import { SceneManager } from './SceneManager.js';
import './styles.css';

const DEFAULT_SCENE_ID = 'demo-scene';

export default function App() {
  const containerRef = useRef(null);
  const sceneManagerRef = useRef(null);
  const collabRef = useRef(null);
  const [nodes, setNodes] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [users, setUsers] = useState([]);
  const [userName, setUserName] = useState('User_' + Math.floor(Math.random() * 1000));
  const [isJoined, setIsJoined] = useState(false);
  const [sceneId, setSceneId] = useState(DEFAULT_SCENE_ID);
  const [transformMode, setTransformMode] = useState('translate');

  const handleSceneChange = useCallback((event) => {
    if (event.type === 'select') {
      setSelectedId(event.id);
      if (event.id && collabRef.current) {
        const node = collabRef.current.yNodes.get(event.id);
        setSelectedNode(node);
      } else {
        setSelectedNode(null);
      }
    }
    if (event.type === 'delete' && event.id && collabRef.current) {
      sceneManagerRef.current?.deleteNode(event.id);
    }
  }, []);

  const joinScene = useCallback(() => {
    if (!containerRef.current || isJoined) return;

    const collab = createCollaboration(sceneId, userName);
    collabRef.current = collab;

    const sm = new SceneManager(containerRef.current, collab.yNodes, collab.yRootId, handleSceneChange);
    sceneManagerRef.current = sm;

    const updateNodesList = () => {
      const nodeList = [];
      collab.yNodes.forEach((node) => {
        nodeList.push(node);
      });
      setNodes(nodeList);
    };

    const updateUsers = () => {
      const userList = [];
      collab.awareness.getStates().forEach((state, clientId) => {
        if (state && state.user) {
          userList.push({ clientId, ...state.user });
        }
      });
      setUsers(userList);
    };

    collab.yNodes.observeDeep(() => {
      sm.syncFromYjs();
      updateNodesList();
      if (selectedId && collab.yNodes.has(selectedId)) {
        setSelectedNode(collab.yNodes.get(selectedId));
      }
    });

    collab.awareness.on('change', updateUsers);
    updateNodesList();
    updateUsers();
    setIsJoined(true);

    setTimeout(() => sm.syncFromYjs(), 200);
  }, [sceneId, userName, isJoined, handleSceneChange, selectedId]);

  useEffect(() => {
    return () => {
      sceneManagerRef.current?.dispose();
      collabRef.current?.destroy();
    };
  }, []);

  useEffect(() => {
    if (sceneManagerRef.current) {
      sceneManagerRef.current.setTransformMode(transformMode);
    }
  }, [transformMode]);

  const addGeometry = (type) => {
    if (!sceneManagerRef.current) return;
    const defaults = {
      box: { width: 1, height: 1, depth: 1 },
      sphere: { radius: 0.5, widthSegments: 32, heightSegments: 32 },
      plane: { width: 2, height: 2 }
    };
    sceneManagerRef.current.addNode({
      type: 'mesh',
      name: type.charAt(0).toUpperCase() + type.slice(1),
      position: {
        x: (Math.random() - 0.5) * 4,
        y: 0.5,
        z: (Math.random() - 0.5) * 4
      },
      geometry: { type, params: defaults[type] },
      material: {
        color: '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'),
        transparent: false,
        opacity: 1
      }
    });
  };

  const addLight = (type) => {
    if (!sceneManagerRef.current) return;
    const lightDefaults = {
      ambientLight: { color: '#ffffff', intensity: 0.5 },
      pointLight: { color: '#ffffff', intensity: 1, distance: 0 },
      directionalLight: { color: '#ffffff', intensity: 1, castShadow: true }
    };
    const posDefaults = {
      ambientLight: { x: 0, y: 0, z: 0 },
      pointLight: { x: 2, y: 3, z: 2 },
      directionalLight: { x: 5, y: 10, z: 7.5 }
    };
    sceneManagerRef.current.addNode({
      type,
      name: type.replace('Light', ' Light'),
      position: posDefaults[type],
      light: lightDefaults[type]
    });
  };

  const updateSelectedNode = (updates) => {
    if (!selectedId || !sceneManagerRef.current) return;
    sceneManagerRef.current.updateNode(selectedId, updates);
  };

  const deleteSelected = () => {
    if (!selectedId || !sceneManagerRef.current) return;
    sceneManagerRef.current.deleteNode(selectedId);
  };

  if (!isJoined) {
    return (
      <div className="login-screen">
        <div className="login-box">
          <h1 className="title">3D Scene Editor</h1>
          <p className="subtitle">Collaborative Real-Time Editing</p>
          <div className="form-group">
            <label>Scene ID</label>
            <input
              type="text"
              value={sceneId}
              onChange={(e) => setSceneId(e.target.value)}
              placeholder="Enter scene ID"
            />
          </div>
          <div className="form-group">
            <label>Your Name</label>
            <input
              type="text"
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="Enter your name"
            />
          </div>
          <button className="btn btn-primary btn-lg" onClick={joinScene}>
            Join Scene
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="sidebar left-sidebar">
        <div className="panel">
          <h3 className="panel-title">Scene Objects</h3>
          <div className="object-list">
            {nodes
              .sort((a, b) => {
                if (a.id === 'root') return -1;
                if (b.id === 'root') return 1;
                return a.name.localeCompare(b.name);
              })
              .map((node) => (
                <div
                  key={node.id}
                  className={`object-item ${selectedId === node.id ? 'selected' : ''}`}
                  onClick={() => {
                    sceneManagerRef.current.selectObject(node.id);
                  }}
                >
                  <span className="icon">{getIconForType(node.type)}</span>
                  <span className="name">{node.name}</span>
                </div>
              ))}
          </div>
        </div>

        <div className="panel">
          <h3 className="panel-title">Online Users</h3>
          <div className="user-list">
            {users.map((user) => (
              <div key={user.clientId} className="user-item">
                <span className="user-dot" style={{ backgroundColor: user.color }} />
                <span>{user.name}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="main-area">
        <div className="toolbar">
          <div className="toolbar-group">
            <span className="toolbar-label">Add Geometry:</span>
            <button className="btn" onClick={() => addGeometry('box')}>Cube</button>
            <button className="btn" onClick={() => addGeometry('sphere')}>Sphere</button>
            <button className="btn" onClick={() => addGeometry('plane')}>Plane</button>
          </div>
          <div className="toolbar-group">
            <span className="toolbar-label">Add Light:</span>
            <button className="btn" onClick={() => addLight('ambientLight')}>Ambient</button>
            <button className="btn" onClick={() => addLight('pointLight')}>Point</button>
            <button className="btn" onClick={() => addLight('directionalLight')}>Directional</button>
          </div>
          <div className="toolbar-group">
            <span className="toolbar-label">Transform:</span>
            <button
              className={`btn ${transformMode === 'translate' ? 'active' : ''}`}
              onClick={() => setTransformMode('translate')}
            >
              Move (Q)
            </button>
            <button
              className={`btn ${transformMode === 'rotate' ? 'active' : ''}`}
              onClick={() => setTransformMode('rotate')}
            >
              Rotate (W)
            </button>
            <button
              className={`btn ${transformMode === 'scale' ? 'active' : ''}`}
              onClick={() => setTransformMode('scale')}
            >
              Scale (E)
            </button>
          </div>
          {selectedId && (
            <div className="toolbar-group">
              <button className="btn btn-danger" onClick={deleteSelected}>
                Delete (Del)
              </button>
            </div>
          )}
          <div className="toolbar-spacer" />
          <div className="toolbar-group">
            <span className="scene-info">Scene: {sceneId}</span>
          </div>
        </div>

        <div className="viewport" ref={containerRef} />

        <div className="statusbar">
          <span>Tip: Click objects to select. Q=Move, W=Rotate, E=Scale, Del=Delete, Esc=Deselect</span>
        </div>
      </div>

      <div className="sidebar right-sidebar">
        <div className="panel">
          <h3 className="panel-title">Properties</h3>
          {selectedNode ? (
            <div className="properties">
              <div className="prop-group">
                <label>Name</label>
                <input
                  type="text"
                  value={selectedNode.name || ''}
                  onChange={(e) => updateSelectedNode({ name: e.target.value })}
                />
              </div>

              <div className="prop-group">
                <label>Position</label>
                <div className="vec3-input">
                  <span className="vec-label x">X</span>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedNode.position?.x || 0}
                    onChange={(e) =>
                      updateSelectedNode({
                        position: {
                          ...selectedNode.position,
                          x: parseFloat(e.target.value) || 0
                        }
                      })
                    }
                  />
                  <span className="vec-label y">Y</span>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedNode.position?.y || 0}
                    onChange={(e) =>
                      updateSelectedNode({
                        position: {
                          ...selectedNode.position,
                          y: parseFloat(e.target.value) || 0
                        }
                      })
                    }
                  />
                  <span className="vec-label z">Z</span>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedNode.position?.z || 0}
                    onChange={(e) =>
                      updateSelectedNode({
                        position: {
                          ...selectedNode.position,
                          z: parseFloat(e.target.value) || 0
                        }
                      })
                    }
                  />
                </div>
              </div>

              <div className="prop-group">
                <label>Rotation (radians)</label>
                <div className="vec3-input">
                  <span className="vec-label x">X</span>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedNode.rotation?.x || 0}
                    onChange={(e) =>
                      updateSelectedNode({
                        rotation: {
                          ...selectedNode.rotation,
                          x: parseFloat(e.target.value) || 0
                        }
                      })
                    }
                  />
                  <span className="vec-label y">Y</span>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedNode.rotation?.y || 0}
                    onChange={(e) =>
                      updateSelectedNode({
                        rotation: {
                          ...selectedNode.rotation,
                          y: parseFloat(e.target.value) || 0
                        }
                      })
                    }
                  />
                  <span className="vec-label z">Z</span>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedNode.rotation?.z || 0}
                    onChange={(e) =>
                      updateSelectedNode({
                        rotation: {
                          ...selectedNode.rotation,
                          z: parseFloat(e.target.value) || 0
                        }
                      })
                    }
                  />
                </div>
              </div>

              <div className="prop-group">
                <label>Scale</label>
                <div className="vec3-input">
                  <span className="vec-label x">X</span>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedNode.scale?.x || 1}
                    onChange={(e) =>
                      updateSelectedNode({
                        scale: {
                          ...selectedNode.scale,
                          x: parseFloat(e.target.value) || 1
                        }
                      })
                    }
                  />
                  <span className="vec-label y">Y</span>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedNode.scale?.y || 1}
                    onChange={(e) =>
                      updateSelectedNode({
                        scale: {
                          ...selectedNode.scale,
                          y: parseFloat(e.target.value) || 1
                        }
                      })
                    }
                  />
                  <span className="vec-label z">Z</span>
                  <input
                    type="number"
                    step="0.1"
                    value={selectedNode.scale?.z || 1}
                    onChange={(e) =>
                      updateSelectedNode({
                        scale: {
                          ...selectedNode.scale,
                          z: parseFloat(e.target.value) || 1
                        }
                      })
                    }
                  />
                </div>
              </div>

              {selectedNode.type === 'mesh' && (
                <>
                  <div className="prop-group">
                    <label>Material Color</label>
                    <div className="color-input">
                      <input
                        type="color"
                        value={selectedNode.material?.color || '#ffffff'}
                        onChange={(e) =>
                          updateSelectedNode({
                            material: { ...selectedNode.material, color: e.target.value }
                          })
                        }
                      />
                      <input
                        type="text"
                        value={selectedNode.material?.color || '#ffffff'}
                        onChange={(e) =>
                          updateSelectedNode({
                            material: { ...selectedNode.material, color: e.target.value }
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="prop-group">
                    <label>Texture URL</label>
                    <input
                      type="text"
                      value={selectedNode.material?.map || ''}
                      placeholder="https://..."
                      onChange={(e) =>
                        updateSelectedNode({
                          material: { ...selectedNode.material, map: e.target.value }
                        })
                      }
                    />
                  </div>
                  <div className="prop-group">
                    <label>
                      <input
                        type="checkbox"
                        checked={selectedNode.material?.transparent || false}
                        onChange={(e) =>
                          updateSelectedNode({
                            material: {
                              ...selectedNode.material,
                              transparent: e.target.checked
                            }
                          })
                        }
                      />
                      Transparent
                    </label>
                  </div>
                  <div className="prop-group">
                    <label>Opacity: {selectedNode.material?.opacity || 1}</label>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.01"
                      value={selectedNode.material?.opacity || 1}
                      onChange={(e) =>
                        updateSelectedNode({
                          material: {
                            ...selectedNode.material,
                            opacity: parseFloat(e.target.value)
                          }
                        })
                      }
                    />
                  </div>
                </>
              )}

              {(selectedNode.type === 'ambientLight' ||
                selectedNode.type === 'pointLight' ||
                selectedNode.type === 'directionalLight') && (
                <>
                  <div className="prop-group">
                    <label>Light Color</label>
                    <div className="color-input">
                      <input
                        type="color"
                        value={selectedNode.light?.color || '#ffffff'}
                        onChange={(e) =>
                          updateSelectedNode({
                            light: { ...selectedNode.light, color: e.target.value }
                          })
                        }
                      />
                      <input
                        type="text"
                        value={selectedNode.light?.color || '#ffffff'}
                        onChange={(e) =>
                          updateSelectedNode({
                            light: { ...selectedNode.light, color: e.target.value }
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="prop-group">
                    <label>Intensity: {selectedNode.light?.intensity || 1}</label>
                    <input
                      type="range"
                      min="0"
                      max="3"
                      step="0.1"
                      value={selectedNode.light?.intensity || 1}
                      onChange={(e) =>
                        updateSelectedNode({
                          light: {
                            ...selectedNode.light,
                            intensity: parseFloat(e.target.value)
                          }
                        })
                      }
                    />
                  </div>
                  {selectedNode.type === 'pointLight' && (
                    <div className="prop-group">
                      <label>Distance</label>
                      <input
                        type="number"
                        step="1"
                        value={selectedNode.light?.distance || 0}
                        onChange={(e) =>
                          updateSelectedNode({
                            light: {
                              ...selectedNode.light,
                              distance: parseFloat(e.target.value) || 0
                            }
                          })
                        }
                      />
                    </div>
                  )}
                </>
              )}

              <div className="prop-group">
                <label>
                  <input
                    type="checkbox"
                    checked={selectedNode.visible !== false}
                    onChange={(e) => updateSelectedNode({ visible: e.target.checked })}
                  />
                  Visible
                </label>
              </div>
            </div>
          ) : (
            <div className="empty-state">
              <p>Select an object to edit its properties.</p>
              <p className="hint">Click an object in the viewport or scene list.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getIconForType(type) {
  switch (type) {
    case 'group':
      return '📁';
    case 'mesh':
      return '⬛';
    case 'ambientLight':
      return '🌤️';
    case 'pointLight':
      return '💡';
    case 'directionalLight':
      return '☀️';
    case 'perspectiveCamera':
      return '📷';
    default:
      return '❓';
  }
}
