import React, { useState, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export default function ARPanel({ collab, onClose }) {
  const containerRef = useRef(null);
  const arContainerRef = useRef(null);
  const [arSupported, setArSupported] = useState(false);
  const [arActive, setArActive] = useState(false);
  const [placingMode, setPlacingMode] = useState(false);
  const [planes, setPlanes] = useState([]);
  const [placedObjects, setPlacedObjects] = useState([]);
  const [hitTestSource, setHitTestSource] = useState(null);
  const [reticle, setReticle] = useState(null);
  const [hitPoint, setHitPoint] = useState(null);

  const arSceneRef = useRef(null);
  const arCameraRef = useRef(null);
  const arRendererRef = useRef(null);
  const arSessionRef = useRef(null);
  const arControlsRef = useRef(null);
  const animFrameRef = useRef(null);
  const originalSceneCopyRef = useRef(null);

  useEffect(() => {
    checkARSupport();
    return () => {
      cleanupAR();
    };
  }, []);

  const checkARSupport = async () => {
    if (!navigator.xr) {
      setArSupported(false);
      return;
    }
    try {
      const supported = await navigator.xr.isSessionSupported('immersive-ar');
      setArSupported(supported);
    } catch (e) {
      console.error('AR support check failed:', e);
      setArSupported(false);
    }
  };

  const buildSceneCopy = (scene) => {
    const group = new THREE.Group();
    if (!collab) return group;

    collab.forEachNode((node) => {
      if (!node.visible || node.type === 'perspectiveCamera') return;
      if (node.type === 'group') return;

      let obj;
      if (node.type === 'mesh') {
        const geom = buildGeometry(node.geometry);
        const mat = buildMaterial(node.material);
        obj = new THREE.Mesh(geom, mat);
        obj.castShadow = true;
        obj.receiveShadow = true;
      } else if (node.type === 'ambientLight') {
        obj = new THREE.AmbientLight(
          new THREE.Color(node.light?.color || '#ffffff'),
          node.light?.intensity || 0.5
        );
      } else if (node.type === 'pointLight') {
        obj = new THREE.PointLight(
          new THREE.Color(node.light?.color || '#ffffff'),
          node.light?.intensity || 1,
          node.light?.distance || 0
        );
      } else if (node.type === 'directionalLight') {
        obj = new THREE.DirectionalLight(
          new THREE.Color(node.light?.color || '#ffffff'),
          node.light?.intensity || 1
        );
      } else {
        return;
      }

      obj.position.set(
        node.position?.x || 0,
        node.position?.y || 0,
        node.position?.z || 0
      );
      obj.rotation.set(
        node.rotation?.x || 0,
        node.rotation?.y || 0,
        node.rotation?.z || 0
      );
      obj.scale.set(
        node.scale?.x || 1,
        node.scale?.y || 1,
        node.scale?.z || 1
      );
      obj.userData.nodeId = node.id;
      group.add(obj);
    });

    return group;
  };

  const buildGeometry = (geometryData) => {
    const defaults = {
      box: { width: 1, height: 1, depth: 1 },
      sphere: { radius: 0.5, widthSegments: 32, heightSegments: 32 },
      plane: { width: 2, height: 2 },
      cylinder: { radiusTop: 0.5, radiusBottom: 0.5, height: 1, radialSegments: 16 }
    };
    if (!geometryData) return new THREE.BoxGeometry(1, 1, 1);
    const params = { ...defaults[geometryData.type], ...geometryData.params };
    switch (geometryData.type) {
      case 'box':
        return new THREE.BoxGeometry(params.width, params.height, params.depth);
      case 'sphere':
        return new THREE.SphereGeometry(params.radius, params.widthSegments, params.heightSegments);
      case 'plane':
        return new THREE.PlaneGeometry(params.width, params.height);
      case 'cylinder':
        return new THREE.CylinderGeometry(
          params.radiusTop, params.radiusBottom, params.height, params.radialSegments
        );
      default:
        return new THREE.BoxGeometry(1, 1, 1);
    }
  };

  const buildMaterial = (materialData) => {
    if (!materialData) return new THREE.MeshStandardMaterial({ color: 0xffffff });
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(materialData.color || '#ffffff'),
      transparent: materialData.transparent || false,
      opacity: materialData.opacity !== undefined ? materialData.opacity : 1,
      roughness: materialData.roughness !== undefined ? materialData.roughness : 0.5,
      metalness: materialData.metalness !== undefined ? materialData.metalness : 0.1,
      side: THREE.DoubleSide
    });
  };

  const initAR = async () => {
    if (!containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight;

    const scene = new THREE.Scene();
    arSceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 2000);
    arCameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');
    containerRef.current.appendChild(renderer.domElement);
    arRendererRef.current = renderer;

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 7.5);
    scene.add(dirLight);

    originalSceneCopyRef.current = buildSceneCopy();
    originalSceneCopyRef.current.visible = false;
    scene.add(originalSceneCopyRef.current);

    const reticleGeom = new THREE.RingGeometry(0.1, 0.12, 32);
    reticleGeom.rotateX(-Math.PI / 2);
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    const reticleMesh = new THREE.Mesh(reticleGeom, reticleMat);
    reticleMesh.visible = false;
    scene.add(reticleMesh);
    setReticle(reticleMesh);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enabled = false;
    arControlsRef.current = controls;

    const button = ARButton.createButton(renderer, {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root: arContainerRef.current }
    });
    button.style.position = 'absolute';
    button.style.bottom = '20px';
    button.style.left = '50%';
    button.style.transform = 'translateX(-50%)';
    button.style.zIndex = '1000';
    arContainerRef.current.appendChild(button);

    renderer.xr.addEventListener('sessionstart', () => {
      setArActive(true);
      setupHitTest(renderer.xr.getSession());
    });

    renderer.xr.addEventListener('sessionend', () => {
      setArActive(false);
      setPlacingMode(false);
      setHitPoint(null);
    });

    arSessionRef.current = renderer.xr.getSession();

    const animate = () => {
      animFrameRef.current = requestAnimationFrame(animate);
      if (arActive && hitPoint && reticle) {
        reticle.position.copy(hitPoint);
        reticle.visible = placingMode;
      }
      renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(animate);
  };

  const setupHitTest = async (session) => {
    try {
      const viewerSpace = await session.requestReferenceSpace('viewer');
      const localSpace = await session.requestReferenceSpace('local');
      const source = await session.requestHitTestSource({ space: viewerSpace });
      setHitTestSource({ source, localSpace });
    } catch (e) {
      console.error('Hit test setup failed:', e);
    }
  };

  const placeObjectAtHit = () => {
    if (!hitPoint || !originalSceneCopyRef.current) return;

    const instance = originalSceneCopyRef.current.clone(true);
    instance.position.copy(hitPoint);
    instance.position.y += 0.01;
    instance.visible = true;

    if (arSceneRef.current) {
      arSceneRef.current.add(instance);
      setPlacedObjects([...placedObjects, instance]);
    }
  };

  const clearPlacedObjects = () => {
    if (arSceneRef.current) {
      placedObjects.forEach((obj) => {
        arSceneRef.current.remove(obj);
      });
    }
    setPlacedObjects([]);
  };

  const toggleSceneVisibility = () => {
    if (originalSceneCopyRef.current) {
      originalSceneCopyRef.current.visible = !originalSceneCopyRef.current.visible;
    }
  };

  const cleanupAR = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }
    if (arRendererRef.current) {
      arRendererRef.current.setAnimationLoop(null);
      arRendererRef.current.dispose();
      if (arRendererRef.current.domElement.parentNode) {
        arRendererRef.current.domElement.parentNode.removeChild(arRendererRef.current.domElement);
      }
    }
    if (arSessionRef.current) {
      try {
        arSessionRef.current.end();
      } catch (e) {
        // ignore
      }
    }
    arSceneRef.current = null;
    arCameraRef.current = null;
    arRendererRef.current = null;
    arSessionRef.current = null;
    originalSceneCopyRef.current = null;
    setHitTestSource(null);
    setReticle(null);
    setHitPoint(null);
    setPlacedObjects([]);
  };

  const handleTouch = (event) => {
    if (!placingMode || !hitPoint) return;
    event.preventDefault();
    placeObjectAtHit();
  };

  useEffect(() => {
    if (hitTestSource && arRendererRef.current) {
      const xr = arRendererRef.current.xr;
      const tempMatrix = new THREE.Matrix4();
      const tempVector = new THREE.Vector3();

      const frameLoop = (time, frame) => {
        if (!frame) return;
        const referenceSpace = xr.getReferenceSpace();
        if (hitTestSource && referenceSpace) {
          const hitTestResults = frame.getHitTestResults(hitTestSource.source);
          if (hitTestResults.length > 0) {
            const hit = hitTestResults[0];
            const pose = hit.getPose(hitTestSource.localSpace);
            if (pose) {
              tempMatrix.fromArray(pose.transform.matrix);
              tempMatrix.decompose(tempVector, new THREE.Quaternion(), new THREE.Vector3());
              setHitPoint(tempVector.clone());
            }
          }
        }
      };
      xr.setAnimationLoop(frameLoop);
    }
  }, [hitTestSource, arActive]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-xl" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📱 AR Preview</h2>
          <button className="btn btn-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          {!arSupported ? (
            <div className="ar-unsupported">
              <div className="ar-icon">❌</div>
              <h3>WebXR AR is not supported on this device</h3>
              <p>
                AR mode requires:
              </p>
              <ul>
                <li>An AR-capable mobile device (Android with ARCore or iOS with ARKit)</li>
                <li>Chrome, Edge, or Safari browser with WebXR support</li>
                <li>HTTPS connection (not localhost)</li>
              </ul>
              <p className="hint">
                Try using a mobile phone with AR capabilities and navigate to this page over HTTPS.
              </p>
            </div>
          ) : (
            <>
              <div className="ar-controls">
                <div className="control-group">
                  <button
                    className={`btn ${placingMode ? 'active' : ''}`}
                    onClick={() => setPlacingMode(!placingMode)}
                  >
                    {placingMode ? '🔴 Stop Placement' : '📍 Place Mode'}
                  </button>
                  <button className="btn" onClick={clearPlacedObjects}>🗑 Clear All</button>
                  <button className="btn" onClick={toggleSceneVisibility}>👁 Toggle Original</button>
                </div>
                <div className="ar-info">
                  <span className={`status-dot ${arActive ? 'active' : ''}`} />
                  {arActive ? 'AR Session Active' : 'Click "Start AR" to begin'}
                </div>
              </div>

              <div
                className="ar-container"
                ref={arContainerRef}
                onTouchStart={handleTouch}
                onClick={handleTouch}
              >
                <div className="ar-canvas" ref={containerRef} />
                {!arActive && (
                  <div className="ar-placeholder">
                    <div className="ar-instructions">
                      <h3>🌍 Augmented Reality Preview</h3>
                      <p>Your 3D scene will be projected into the real world.</p>
                      <ol>
                        <li>Click "Start AR" below</li>
                        <li>Point your camera at a flat surface (floor, table)</li>
                        <li>Move your phone around to detect planes</li>
                        <li>Tap the screen to place objects</li>
                      </ol>
                      <p className="hint">
                        Make sure you're using a mobile phone with AR capabilities.
                      </p>
                    </div>
                  </div>
                )}
                {placingMode && arActive && (
                  <div className="ar-overlay">
                    <div className="ar-placement-hint">
                      👆 Tap on the detected surface to place the scene
                    </div>
                  </div>
                )}
              </div>

              <div className="ar-stats">
                <div className="stat">
                  <span className="stat-label">Placed objects:</span>
                  <span className="stat-value">{placedObjects.length}</span>
                </div>
                <div className="stat">
                  <span className="stat-label">Detected hit:</span>
                  <span className="stat-value">
                    {hitPoint
                      ? `(${hitPoint.x.toFixed(2)}, ${hitPoint.y.toFixed(2)}, ${hitPoint.z.toFixed(2)})`
                      : 'none'}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
