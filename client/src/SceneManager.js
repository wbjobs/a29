import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_GEOMETRIES = {
  box: { width: 1, height: 1, depth: 1 },
  sphere: { radius: 0.5, widthSegments: 32, heightSegments: 32 },
  plane: { width: 2, height: 2 }
};

const LERP_FACTOR = 0.15;
const LERP_THRESHOLD = 0.001;
const ROTATION_LERP_THRESHOLD = 0.001;

export class SceneManager {
  constructor(container, collab, onChange) {
    this.container = container;
    this.collab = collab;
    this.onChange = onChange;

    this.objectMap = new Map();
    this.targetTransforms = new Map();
    this.selectedId = null;
    this.object3DToId = new WeakMap();
    this.suppressUpdates = false;
    this.isDraggingLocal = false;

    this.init();
    this.setupCollabListeners();
    this.syncFromCollab();
  }

  init() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    this.camera = new THREE.PerspectiveCamera(
      50,
      this.container.clientWidth / this.container.clientHeight,
      0.1,
      2000
    );
    this.camera.position.set(0, 5, 10);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.ndc = new THREE.Vector2();

    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.damping = 0.2;
    this.orbitControls.enableDamping = true;
    this.orbitControls.target.set(0, 0, 0);

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.orbitControls.enabled = !event.value;
      this.isDraggingLocal = event.value;
      if (!event.value && this.selectedId) {
        this.commitTransformFromObject(this.selectedId);
      }
    });
    this.transformControls.addEventListener('objectChange', () => {
      const obj = this.transformControls.object;
      if (obj && this.object3DToId.has(obj) && this.isDraggingLocal) {
        const id = this.object3DToId.get(obj);
        this.updateTargetTransformFromObject(id, obj);
      }
    });
    this.scene.add(this.transformControls);

    const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
    this.scene.add(gridHelper);

    this.setupMouseEventListeners();
    this.setupResizeListener();
    this.clock = new THREE.Clock();
    this.animate();
  }

  setupCollabListeners() {
    this.unsubscribeCollab = this.collab.subscribe(() => {
      if (!this.suppressUpdates) {
        this.syncFromCollab();
        this.onChange && this.onChange({ type: 'scene-change' });
      }
    });
  }

  setupMouseEventListeners() {
    this.onMouseDown = (event) => this.handleMouseDown(event);
    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.renderer.domElement.addEventListener('pointerdown', this.onMouseDown);
    window.addEventListener('keydown', this.onKeyDown);
  }

  setupResizeListener() {
    this.onResize = () => {
      if (!this.container) return;
      this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    };
    window.addEventListener('resize', this.onResize);
  }

  handleMouseDown(event) {
    if (event.button !== 0) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    const canvas = this.renderer.domElement;

    const pixelRatio = this.renderer.getPixelRatio();
    const canvasWidth = canvas.width / pixelRatio;
    const canvasHeight = canvas.height / pixelRatio;

    const x = (event.clientX - rect.left) * (canvasWidth / rect.width);
    const y = (event.clientY - rect.top) * (canvasHeight / rect.height);

    this.ndc.x = (x / canvasWidth) * 2 - 1;
    this.ndc.y = -(y / canvasHeight) * 2 + 1;

    this.mouse.x = this.ndc.x;
    this.mouse.y = this.ndc.y;

    this.raycaster.setFromCamera(this.ndc, this.camera);

    const pickableObjects = [];
    this.objectMap.forEach((obj) => {
      if (obj.isMesh) pickableObjects.push(obj);
    });

    const intersects = this.raycaster.intersectObjects(pickableObjects, false);
    if (intersects.length > 0) {
      const obj = intersects[0].object;
      if (this.object3DToId.has(obj)) {
        this.selectObject(this.object3DToId.get(obj));
      }
    } else {
      this.selectObject(null);
    }
  }

  handleKeyDown(event) {
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      if (event.key === 'z' || event.key === 'Z') {
        event.preventDefault();
        if (event.shiftKey) {
          this.redo();
        } else {
          this.undo();
        }
        return;
      }
      if (event.key === 'y' || event.key === 'Y') {
        event.preventDefault();
        this.redo();
        return;
      }
    }

    if (event.key === 'q' || event.key === 'Q') {
      this.setTransformMode('translate');
    } else if (event.key === 'w' || event.key === 'W') {
      this.setTransformMode('rotate');
    } else if (event.key === 'e' || event.key === 'E') {
      this.setTransformMode('scale');
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.selectedId) {
        this.deleteNode(this.selectedId);
      }
    } else if (event.key === 'Escape') {
      this.selectObject(null);
    }
  }

  setTransformMode(mode) {
    if (this.transformControls) {
      this.transformControls.setMode(mode);
    }
  }

  selectObject(id) {
    this.selectedId = id;
    if (id && this.objectMap.has(id)) {
      this.transformControls.attach(this.objectMap.get(id));
    } else {
      this.transformControls.detach();
    }
    this.onChange && this.onChange({ type: 'select', id });
  }

  setTargetTransform(id, node, immediate = false) {
    if (!this.targetTransforms.has(id)) {
      this.targetTransforms.set(id, {
        position: new THREE.Vector3(),
        rotation: new THREE.Euler(),
        scale: new THREE.Vector3()
      });
    }
    const target = this.targetTransforms.get(id);

    target.position.set(
      node.position?.x ?? 0,
      node.position?.y ?? 0,
      node.position?.z ?? 0
    );
    target.rotation.set(
      node.rotation?.x ?? 0,
      node.rotation?.y ?? 0,
      node.rotation?.z ?? 0
    );
    target.scale.set(
      node.scale?.x ?? 1,
      node.scale?.y ?? 1,
      node.scale?.z ?? 1
    );

    if (immediate) {
      const obj = this.objectMap.get(id);
      if (obj) {
        obj.position.copy(target.position);
        obj.rotation.copy(target.rotation);
        obj.scale.copy(target.scale);
      }
    }
  }

  updateTargetTransformFromObject(id, obj) {
    if (!this.targetTransforms.has(id)) {
      this.targetTransforms.set(id, {
        position: new THREE.Vector3(),
        rotation: new THREE.Euler(),
        scale: new THREE.Vector3()
      });
    }
    const target = this.targetTransforms.get(id);
    target.position.copy(obj.position);
    target.rotation.copy(obj.rotation);
    target.scale.copy(obj.scale);
  }

  commitTransformFromObject(id) {
    const obj = this.objectMap.get(id);
    if (!obj) return;

    const position = { x: obj.position.x, y: obj.position.y, z: obj.position.z };
    const rotation = { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z };
    const scale = { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z };

    this.suppressUpdates = true;

    this.collab.updateNode(id, 'position', position, false);
    this.collab.updateNode(id, 'rotation', rotation, false);
    this.collab.updateNode(id, 'scale', scale, false);

    const node = this.collab.getNode(id);
    if (node) {
      const op = {
        opId: uuidv4(),
        type: 'update',
        userId: this.collab.userId,
        timestamp: Date.now(),
        nodeId: id,
        path: 'transform',
        value: { position, rotation, scale }
      };
      this.collab.history.undoStack.push(op);
      if (this.collab.history.undoStack.length > 100) {
        this.collab.history.undoStack.shift();
      }
      this.collab.history.redoStack = [];
    }

    this.suppressUpdates = false;
  }

  lerpObjectTransform(id, obj, delta) {
    const target = this.targetTransforms.get(id);
    if (!target) return false;

    let changed = false;

    const lerpFactor = Math.min(1, LERP_FACTOR * (delta * 60));

    const posDist = obj.position.distanceTo(target.position);
    if (posDist > LERP_THRESHOLD) {
      obj.position.lerp(target.position, lerpFactor);
      changed = true;
    } else if (posDist > 0) {
      obj.position.copy(target.position);
    }

    const rotDist = Math.abs(obj.rotation.x - target.rotation.x) +
      Math.abs(obj.rotation.y - target.rotation.y) +
      Math.abs(obj.rotation.z - target.rotation.z);
    if (rotDist > ROTATION_LERP_THRESHOLD) {
      obj.rotation.x = THREE.MathUtils.lerp(obj.rotation.x, target.rotation.x, lerpFactor);
      obj.rotation.y = THREE.MathUtils.lerp(obj.rotation.y, target.rotation.y, lerpFactor);
      obj.rotation.z = THREE.MathUtils.lerp(obj.rotation.z, target.rotation.z, lerpFactor);
      changed = true;
    }

    const scaleDist = obj.scale.distanceTo(target.scale);
    if (scaleDist > LERP_THRESHOLD) {
      obj.scale.lerp(target.scale, lerpFactor);
      changed = true;
    } else if (scaleDist > 0) {
      obj.scale.copy(target.scale);
    }

    return changed;
  }

  buildGeometry(geometryData) {
    if (!geometryData) return new THREE.BoxGeometry(1, 1, 1);
    const params = { ...DEFAULT_GEOMETRIES[geometryData.type], ...geometryData.params };
    switch (geometryData.type) {
      case 'box':
        return new THREE.BoxGeometry(params.width, params.height, params.depth);
      case 'sphere':
        return new THREE.SphereGeometry(params.radius, params.widthSegments, params.heightSegments);
      case 'plane':
        return new THREE.PlaneGeometry(params.width, params.height);
      default:
        return new THREE.BoxGeometry(1, 1, 1);
    }
  }

  buildMaterial(materialData) {
    if (!materialData) return new THREE.MeshStandardMaterial({ color: 0xffffff });
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(materialData.color || '#ffffff'),
      transparent: materialData.transparent || false,
      opacity: materialData.opacity !== undefined ? materialData.opacity : 1,
      side: THREE.DoubleSide
    });
    if (materialData.map) {
      try {
        const textureLoader = new THREE.TextureLoader();
        material.map = textureLoader.load(materialData.map);
        material.needsUpdate = true;
      } catch (e) {
        console.warn('Failed to load texture:', e);
      }
    }
    return material;
  }

  buildLight(node) {
    const lightData = node.light || {};
    const color = new THREE.Color(lightData.color || '#ffffff');
    const intensity = lightData.intensity !== undefined ? lightData.intensity : 1;

    let light;
    switch (node.type) {
      case 'ambientLight':
        light = new THREE.AmbientLight(color, intensity);
        break;
      case 'pointLight':
        light = new THREE.PointLight(color, intensity, lightData.distance || 0, lightData.decay || 2);
        light.castShadow = lightData.castShadow || false;
        break;
      case 'directionalLight':
        light = new THREE.DirectionalLight(color, intensity);
        light.castShadow = lightData.castShadow || false;
        light.shadow.mapSize.width = 2048;
        light.shadow.mapSize.height = 2048;
        light.shadow.camera.near = 0.5;
        light.shadow.camera.far = 500;
        light.shadow.camera.left = -50;
        light.shadow.camera.right = 50;
        light.shadow.camera.top = 50;
        light.shadow.camera.bottom = -50;
        break;
      default:
        light = new THREE.AmbientLight(color, intensity);
    }
    return light;
  }

  buildObject3D(node) {
    let obj;
    switch (node.type) {
      case 'group':
      case 'perspectiveCamera':
        obj = new THREE.Group();
        break;
      case 'mesh':
        obj = new THREE.Mesh(this.buildGeometry(node.geometry), this.buildMaterial(node.material));
        obj.castShadow = true;
        obj.receiveShadow = true;
        break;
      case 'ambientLight':
      case 'pointLight':
      case 'directionalLight':
        obj = this.buildLight(node);
        break;
      default:
        obj = new THREE.Object3D();
    }

    obj.name = node.name || node.id;
    obj.visible = node.visible !== false;

    this.setTargetTransform(node.id, node, true);

    this.object3DToId.set(obj, node.id);
    return obj;
  }

  applyNodeToScene(node) {
    let obj = this.objectMap.get(node.id);
    const isNew = !obj;

    if (isNew) {
      obj = this.buildObject3D(node);
      this.objectMap.set(node.id, obj);
      this.scene.add(obj);
    } else {
      this.updateObjectFromNode(obj, node);
    }

    if (node.parentId && this.objectMap.has(node.parentId)) {
      const parent = this.objectMap.get(node.parentId);
      if (obj.parent !== parent) {
        parent.add(obj);
      }
    } else if (obj.parent !== this.scene) {
      this.scene.add(obj);
    }

    if (this.selectedId === node.id && this.transformControls.object !== obj) {
      this.transformControls.attach(obj);
    }

    if (isNew) {
      this.setTargetTransform(node.id, node, true);
    }
  }

  updateObjectFromNode(obj, node) {
    const id = this.object3DToId.get(obj);
    const isLocalDragging = this.isDraggingLocal && id === this.selectedId;

    obj.name = node.name || node.id;
    obj.visible = node.visible !== false;

    if (!isLocalDragging) {
      this.setTargetTransform(id, node, false);
    }

    if (node.type === 'mesh') {
      const needsGeomUpdate = !obj.geometry ||
        (node.geometry && obj.userData.lastGeometryType !== node.geometry.type);
      if (needsGeomUpdate) {
        if (obj.geometry) obj.geometry.dispose();
        obj.geometry = this.buildGeometry(node.geometry);
        obj.userData.lastGeometryType = node.geometry?.type;
      }

      const needsMatUpdate = !obj.material ||
        (node.material && (
          obj.material.color.getHexString() !== new THREE.Color(node.material.color).getHexString() ||
          obj.material.transparent !== node.material.transparent ||
          obj.material.opacity !== node.material.opacity
        ));
      if (needsMatUpdate) {
        if (obj.material) obj.material.dispose();
        obj.material = this.buildMaterial(node.material);
      }
    }

    if (node.type === 'ambientLight' || node.type === 'pointLight' || node.type === 'directionalLight') {
      const lightData = node.light || {};
      if (lightData.color !== undefined) {
        obj.color = new THREE.Color(lightData.color);
      }
      if (lightData.intensity !== undefined) {
        obj.intensity = lightData.intensity;
      }
    }
  }

  removeNodeFromScene(id) {
    const obj = this.objectMap.get(id);
    if (obj) {
      if (this.selectedId === id) {
        this.transformControls.detach();
        this.selectedId = null;
      }
      this.scene.remove(obj);
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) {
          obj.material.forEach((m) => m.dispose());
        } else {
          obj.material.dispose();
        }
      }
      this.objectMap.delete(id);
      this.targetTransforms.delete(id);
    }
  }

  syncFromCollab() {
    const existingIds = new Set(this.objectMap.keys());
    const currentIds = new Set();

    this.collab.forEachNode((node) => {
      currentIds.add(node.id);
      this.applyNodeToScene(node);
    });

    existingIds.forEach((id) => {
      if (!currentIds.has(id)) {
        this.removeNodeFromScene(id);
      }
    });
  }

  addNode(nodeData) {
    const id = nodeData.id || uuidv4();
    const node = {
      id,
      type: nodeData.type,
      name: nodeData.name || `${nodeData.type}_${Date.now()}`,
      parentId: nodeData.parentId || this.collab.rootId,
      children: [],
      position: nodeData.position || { x: 0, y: 0, z: 0 },
      rotation: nodeData.rotation || { x: 0, y: 0, z: 0 },
      scale: nodeData.scale || { x: 1, y: 1, z: 1 },
      geometry: nodeData.geometry,
      material: nodeData.material || { color: '#ffffff', transparent: false, opacity: 1 },
      light: nodeData.light,
      camera: nodeData.camera,
      visible: true
    };

    this.collab.addNode(node, true);
    this.selectObject(id);
    return id;
  }

  updateNode(id, updates) {
    this.suppressUpdates = true;
    for (const [key, value] of Object.entries(updates)) {
      this.collab.updateNode(id, key, value, true);
    }
    this.suppressUpdates = false;
    this.syncFromCollab();
  }

  deleteNode(id) {
    this.collab.removeNode(id, true);
  }

  undo() {
    this.suppressUpdates = true;
    const result = this.collab.undo();
    this.suppressUpdates = false;
    if (result) {
      this.syncFromCollab();
      this.onChange && this.onChange({ type: 'undo' });
    }
    return result;
  }

  redo() {
    this.suppressUpdates = true;
    const result = this.collab.redo();
    this.suppressUpdates = false;
    if (result) {
      this.syncFromCollab();
      this.onChange && this.onChange({ type: 'redo' });
    }
    return result;
  }

  canUndo() {
    return this.collab.canUndo();
  }

  canRedo() {
    return this.collab.canRedo();
  }

  animate = () => {
    requestAnimationFrame(this.animate);

    const delta = this.clock.getDelta();

    if (!this.isDraggingLocal) {
      this.objectMap.forEach((obj, id) => {
        this.lerpObjectTransform(id, obj, delta);
      });
    }

    this.orbitControls.update();
    this.renderer.render(this.scene, this.camera);
  };

  addAIGeneratedGroup(groupData, childrenData) {
    if (!groupData) return;

    this.suppressUpdates = true;
    const groupId = this.collab.addNode(groupData, true);

    if (childrenData && Array.isArray(childrenData)) {
      childrenData.forEach((child) => {
        this.collab.addNode(child, false);
      });
    }

    this.suppressUpdates = false;
    this.syncFromCollab();

    if (groupId) {
      this.selectObject(groupId);
    }
    return groupId;
  }

  dispose() {
    this.unsubscribeCollab && this.unsubscribeCollab();
    this.renderer.domElement.removeEventListener('pointerdown', this.onMouseDown);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('resize', this.onResize);
    this.transformControls.dispose();
    this.orbitControls.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
