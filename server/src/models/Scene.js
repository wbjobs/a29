const mongoose = require('mongoose');

const ObjectNodeSchema = new mongoose.Schema({
  id: { type: String, required: true },
  type: { type: String, required: true, enum: ['group', 'mesh', 'ambientLight', 'pointLight', 'directionalLight', 'perspectiveCamera'] },
  name: { type: String, default: '' },
  parentId: { type: String, default: null },
  children: [{ type: String }],
  position: { x: Number, y: Number, z: Number },
  rotation: { x: Number, y: Number, z: Number },
  scale: { x: Number, y: Number, z: Number },
  geometry: {
    type: {
      type: String,
      enum: ['box', 'sphere', 'plane'],
      default: undefined
    },
    params: mongoose.Schema.Types.Mixed
  },
  material: {
    color: { type: String, default: '#ffffff' },
    transparent: { type: Boolean, default: false },
    opacity: { type: Number, default: 1 },
    map: { type: String, default: null }
  },
  light: {
    color: { type: String, default: '#ffffff' },
    intensity: { type: Number, default: 1 },
    distance: { type: Number, default: 0 },
    decay: { type: Number, default: 2 },
    castShadow: { type: Boolean, default: false }
  },
  camera: {
    fov: { type: Number, default: 50 },
    near: { type: Number, default: 0.1 },
    far: { type: Number, default: 2000 }
  },
  visible: { type: Boolean, default: true },
  userData: mongoose.Schema.Types.Mixed
}, { _id: false });

const SceneSchema = new mongoose.Schema({
  sceneId: { type: String, required: true, unique: true, index: true },
  name: { type: String, default: 'Untitled Scene' },
  rootNode: { type: ObjectNodeSchema, required: true },
  nodes: { type: Map, of: ObjectNodeSchema, default: {} },
  yjsState: { type: Buffer, default: null },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

SceneSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Scene', SceneSchema);
