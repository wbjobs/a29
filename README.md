# 3D Scene Editor (Collaborative)

A collaborative 3D scene editor built with React, Three.js, Node.js, Socket.io, Yjs (CRDT), Redis Pub/Sub, and MongoDB.

## Features

- 3D scene editing with Three.js
- Support for geometries: Cube, Sphere, Plane
- Lighting: Ambient, Point, Directional lights
- Material properties: Color, Texture, Transparency
- Camera controls
- Real-time collaborative editing via Socket.io
- Conflict resolution with Yjs CRDT
- Multi-instance scaling with Redis Pub/Sub
- Scene persistence with MongoDB

## Project Structure

```
.
├── server/          # Node.js backend
└── client/          # React frontend
```

## Getting Started

### Prerequisites

- Node.js >= 18
- MongoDB
- Redis

### Installation

#### Backend

```bash
cd server
npm install
npm start
```

#### Frontend

```bash
cd client
npm install
npm run dev
```

Open multiple browser tabs to test real-time collaboration.
