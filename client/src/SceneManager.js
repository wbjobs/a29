import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_GEOMETRIES = {
  box: { width: 1, height: 1, depth: 1 },
  sphere: { radius: 0.5, widthSegments: 32, heightSegments: 32 },
  plane: { width: 2, height: 2 }
};

export class SceneManager {
  constructor(container, yNodes, yRootId, onChange) {
    this.container = container;
    this.yNodes = yNodes;
    this.yRootId = yRootId;
    this.onChange = onChange;
    this.objectMap = new Map();
    this.selectedId = null;
    this.object3DToId = new WeakMap();
    this.suppressYjsUpdates = false;

    this.init();
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

    this.orbitControls = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbitControls.damping = 0.2;
    this.orbitControls.target.set(0, 0, 0);

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.orbitControls.enabled = !event.value;
    });
    this.transformControls.addEventListener('objectChange', () => {
      const obj = this.transformControls.object;
      if (obj && this.object3DToId.has(obj) && !this.suppressYjsUpdates) {
        const id = this.object3DToId.get(obj);
        this.updateNodeTransform(id, obj);
      }
    });
    this.scene.add(this.transformControls);

    const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222);
    this.scene.add(gridHelper);

    this.setupMouseEventListeners();
    this.setupResizeListener();
    this.animate();
  }

  setupMouseEventListeners() {
    this.onMouseDown = (event) => this.handleMouseDown(event);
    this.onKeyDown = (event) => this.handleKeyDown(event);
    this.renderer.domElement.addEventListener('pointerdown', this.onMouseDown);
    window.addEventListener('keydown', this.onKeyDown);
  }

  setupResizeListener() {
    this.onResize = () => {
      this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    };
    window.addEventListener('resize', this.onResize);
  }

  handleMouseDown(event) {
    if (event.button !== 0) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);

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
    if (event.key === 'q' || event.key === 'Q') {
      this.setTransformMode('translate');
    } else if (event.key === 'w' || event.key === 'W') {
      this.setTransformMode('rotate');
    } else if (event.key === 'e' || event.key === 'E') {
      this.setTransformMode('scale');
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      if (this.selectedId) {
        this.onChange && this.onChange({
          type: 'delete',
          id: this.selectedId
        });
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

  updateNodeTransform(id, obj) {
    const node = this.yNodes.get(id);
    if (!node) return;
    const newNode = {
      ...node,
      position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
      rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
      scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z }
    };
    this.yNodes.set(id, newNode);
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
    if (node.position) obj.position.set(node.position.x || 0, node.position.y || 0, node.position.z || 0);
    if (node.rotation) obj.rotation.set(node.rotation.x || 0, node.rotation.y || 0, node.rotation.z || 0);
    if (node.scale) obj.scale.set(node.scale.x || 1, node.scale.y || 1, node.scale.z || 1);

    this.object3DToId.set(obj, node.id);
    return obj;
  }

  applyNodeToScene(node) {
    let obj = this.objectMap.get(node.id);
    if (!obj) {
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
  }

  updateObjectFromNode(obj, node) {
    this.suppressYjsUpdates = true;
    obj.name = node.name || node.id;
    obj.visible = node.visible !== false;
    if (node.position) obj.position.set(node.position.x || 0, node.position.y || 0, node.position.z || 0);
    if (node.rotation) obj.rotation.set(node.rotation.x || 0, node.rotation.y || 0, node.rotation.z || 0);
    if (node.scale) obj.scale.set(node.scale.x || 1, node.scale.y || 1, node.scale.z || 1);

    if (node.type === 'mesh') {
      if (obj.geometry) obj.geometry.dispose();
      obj.geometry = this.buildGeometry(node.geometry);
      if (obj.material) obj.material.dispose();
      obj.material = this.buildMaterial(node.material);
    }

    if (node.type === 'ambientLight' || node.type === 'pointLight' || node.type === 'directionalLight') {
      const lightData = node.light || {};
      obj.color = new THREE.Color(lightData.color || '#ffffff');
      obj.intensity = lightData.intensity !== undefined ? lightData.intensity : 1;
    }

    this.suppressYjsUpdates = false;
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
    }
  }

  syncFromYjs() {
    const existingIds = new Set(this.objectMap.keys());
    const currentIds = new Set();

    this.yNodes.forEach((node) => {
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
      parentId: nodeData.parentId || this.yRootId.toString(),
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

    this.yNodes.set(id, node);

    const parentId = node.parentId;
    if (parentId && this.yNodes.has(parentId)) {
      const parent = this.yNodes.get(parentId);
      const newParent = { ...parent, children: [...(parent.children || []), id] };
      this.yNodes.set(parentId, newParent);
    }

    this.selectObject(id);
    return id;
  }

  updateNode(id, updates) {
    const node = this.yNodes.get(id);
    if (!node) return;
    const newNode = { ...node, ...updates };
    this.yNodes.set(id, newNode);
  }

  deleteNode(id) {
    const node = this.yNodes.get(id);
    if (!node) return;

    const parentId = node.parentId;
    if (parentId && this.yNodes.has(parentId)) {
      const parent = this.yNodes.get(parentId);
      const newParent = {
        ...parent,
        children: (parent.children || []).filter((c) => c !== id)
      };
      this.yNodes.set(parentId, newParent);
    }

    const deleteChildren = (children) => {
      children.forEach((childId) => {
        const child = this.yNodes.get(childId);
        if (child) {
          if (child.children) deleteChildren(child.children);
          this.yNodes.delete(childId);
        }
      });
    };
    if (node.children) deleteChildren(node.children);

    this.yNodes.delete(id);
    if (this.selectedId === id) {
      this.selectObject(null);
    }
  }

  animate = () => {
    requestAnimationFrame(this.animate);
    this.orbitControls.update();
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
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
