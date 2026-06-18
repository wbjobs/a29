import React, { useState, useRef } from 'react';
import * as THREE from 'three';

const PRESETS = [
  'a wooden round table with legs',
  'a chair with four legs and a backrest',
  'a small house with a roof and door',
  'a modern office desk',
  'a bookshelf with multiple shelves',
  'a bed with pillows',
  'a lamp with a shade',
  'a simple car body'
];

export default function AIPanel({ onAddObject, onClose }) {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedCode, setGeneratedCode] = useState('');
  const [error, setError] = useState('');
  const [previewMesh, setPreviewMesh] = useState(null);
  const previewRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const animFrameRef = useRef(null);

  const executeGeneratedCode = (code) => {
    try {
      const resultGroup = null;
      const func = new Function('THREE', `
        "use strict";
        ${code}
        if (typeof resultGroup !== 'undefined') {
          return resultGroup;
        }
        return null;
      `);
      const group = func(THREE);
      return group;
    } catch (e) {
      console.error('Code execution error:', e);
      throw e;
    }
  };

  const generateCode = async () => {
    if (!prompt.trim()) return;

    setIsGenerating(true);
    setError('');
    setGeneratedCode('');

    try {
      const res = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() })
      });

      const data = await res.json();

      if (data.success || data.code) {
        setGeneratedCode(data.code);
        if (!data.success && data.error) {
          setError(`Note: ${data.error}. Using fallback generation.`);
        }
      } else {
        throw new Error(data.error || 'Generation failed');
      }
    } catch (e) {
      console.error('Generation error:', e);
      setError(e.message || 'Failed to generate');
    } finally {
      setIsGenerating(false);
    }
  };

  const showPreview = () => {
    if (!generatedCode) return;
    try {
      const group = executeGeneratedCode(generatedCode);
      if (group) {
        if (previewMesh.current) {
          sceneRef.current?.remove(previewMesh.current);
        }
        previewMesh.current = group;
        sceneRef.current?.add(group);
        framePreview();
      }
    } catch (e) {
      setError('Preview failed: ' + e.message);
    }
  };

  const initPreview = () => {
    if (sceneRef.current) return;

    const width = previewRef.current.clientWidth;
    const height = previewRef.current.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
    camera.position.set(2, 2, 4);
    camera.lookAt(0, 1, 0);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    previewRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(5, 10, 7.5);
    scene.add(dirLight);

    const gridHelper = new THREE.GridHelper(5, 10, 0x444444, 0x222222);
    scene.add(gridHelper);
  };

  const framePreview = () => {
    if (!rendererRef.current || !sceneRef.current || !cameraRef.current) return;

    let angle = 0;
    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      angle += 0.01;
      if (cameraRef.current) {
        cameraRef.current.position.x = Math.sin(angle) * 4;
        cameraRef.current.position.z = Math.cos(angle) * 4;
        cameraRef.current.lookAt(0, 1, 0);
      }
      rendererRef.current.render(sceneRef.current, cameraRef.current);
    };
    animate();
  };

  const cleanupPreview = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    if (rendererRef.current) {
      rendererRef.current.dispose();
      if (rendererRef.current.domElement.parentNode) {
        rendererRef.current.domElement.parentNode.removeChild(rendererRef.current.domElement);
      }
    }
    sceneRef.current = null;
    cameraRef.current = null;
    rendererRef.current = null;
    previewMesh.current = null;
  };

  const addToScene = () => {
    if (!generatedCode) return;
    try {
      const group = executeGeneratedCode(generatedCode);
      if (group) {
        const childrenData = [];
        group.traverse((child) => {
          if (child.isMesh) {
            childrenData.push({
              type: 'mesh',
              name: child.name || `mesh_${Date.now()}`,
              position: { x: child.position.x, y: child.position.y, z: child.position.z },
              rotation: { x: child.rotation.x, y: child.rotation.y, z: child.rotation.z },
              scale: { x: child.scale.x, y: child.scale.y, z: child.scale.z },
              geometry: extractGeometryData(child.geometry),
              material: extractMaterialData(child.material)
            });
          }
        });

        const groupId = Date.now().toString();
        const groupData = {
          id: groupId,
          type: 'group',
          name: `AI: ${prompt.substring(0, 30)}`,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          children: childrenData.map(c => c.id)
        };

        childrenData.forEach((child, idx) => {
          child.id = `${groupId}_${idx}`;
          child.parentId = groupId;
        });

        onAddObject && onAddObject(groupData, childrenData);
        onClose && onClose();
      }
    } catch (e) {
      setError('Failed to add to scene: ' + e.message);
    }
  };

  const extractGeometryData = (geometry) => {
    if (geometry.type === 'BoxGeometry') {
      return {
        type: 'box',
        params: {
          width: geometry.parameters.width,
          height: geometry.parameters.height,
          depth: geometry.parameters.depth
        }
      };
    }
    if (geometry.type === 'SphereGeometry') {
      return {
        type: 'sphere',
        params: {
          radius: geometry.parameters.radius,
          widthSegments: geometry.parameters.widthSegments,
          heightSegments: geometry.parameters.heightSegments
        }
      };
    }
    if (geometry.type === 'CylinderGeometry') {
      return {
        type: 'cylinder',
        params: {
          radiusTop: geometry.parameters.radiusTop,
          radiusBottom: geometry.parameters.radiusBottom,
          height: geometry.parameters.height,
          radialSegments: geometry.parameters.radialSegments
        }
      };
    }
    if (geometry.type === 'PlaneGeometry') {
      return {
        type: 'plane',
        params: {
          width: geometry.parameters.width,
          height: geometry.parameters.height
        }
      };
    }
    return {
      type: 'box',
      params: { width: 1, height: 1, depth: 1 }
    };
  };

  const extractMaterialData = (material) => {
    const hex = material.color ? '#' + material.color.getHexString() : '#ffffff';
    return {
      color: hex,
      transparent: material.transparent || false,
      opacity: material.opacity !== undefined ? material.opacity : 1,
      roughness: material.roughness,
      metalness: material.metalness
    };
  };

  React.useEffect(() => {
    const timer = setTimeout(() => initPreview(), 50);
    return () => {
      cleanupPreview();
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-large" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>🤖 AI Model Generator</h2>
          <button className="btn btn-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="ai-section">
            <label>Describe the object you want to generate:</label>
            <textarea
              className="ai-prompt"
              placeholder="e.g., 'a round wooden table with 4 legs', 'a modern chair with metal frame', 'a bookshelf with 5 shelves'"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
            />

            <div className="preset-tags">
              {PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  className="tag-btn"
                  onClick={() => setPrompt(preset)}
                >
                  {preset}
                </button>
              ))}
            </div>

            <button
              className="btn btn-primary btn-lg"
              onClick={generateCode}
              disabled={isGenerating || !prompt.trim()}
            >
              {isGenerating ? '✨ Generating...' : '✨ Generate with AI'}
            </button>

            {error && <div className="error-message">{error}</div>}
          </div>

          {generatedCode && (
            <div className="ai-result">
              <div className="result-header">
                <h4>Generated Code</h4>
                <div className="result-actions">
                  <button className="btn" onClick={showPreview}>👁 Preview</button>
                  <button className="btn btn-primary" onClick={addToScene}>+ Add to Scene</button>
                </div>
              </div>

              <div className="ai-preview" ref={previewRef} />

              <div className="code-block">
                <pre>{generatedCode}</pre>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
