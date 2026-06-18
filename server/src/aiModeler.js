require('dotenv').config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

const SYSTEM_PROMPT = `You are an expert 3D modeling assistant that generates Three.js code to create 3D objects based on user descriptions.

RULES:
1. ONLY output the JavaScript code that creates the object(s), no explanations, no markdown
2. The code must create a THREE.Group containing all the objects
3. The code should assign the group to a variable called 'resultGroup'
4. Use standard Three.js primitives: BoxGeometry, SphereGeometry, CylinderGeometry, TorusGeometry, PlaneGeometry, etc.
5. Use MeshStandardMaterial for realistic materials
6. Position objects relative to the group origin (0,0,0)
7. Add proper materials, colors, and if needed, multiple meshes
8. Set castShadow = true and receiveShadow = true for meshes
9. Do NOT import or require anything - assume THREE is globally available
10. Keep the code efficient and well-structured
11. For complex objects, break them into logical parts

EXAMPLE INPUT: "a wooden table with four legs"
EXAMPLE OUTPUT:
const resultGroup = new THREE.Group();
const tableMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.7, metalness: 0.1 });
const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 1), tableMaterial);
top.position.y = 1;
top.castShadow = true;
top.receiveShadow = true;
resultGroup.add(top);
const legPositions = [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]];
for (const [lx, lz] of legPositions) {
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), tableMaterial);
  leg.position.set(lx, 0.5, lz);
  leg.castShadow = true;
  leg.receiveShadow = true;
  resultGroup.add(leg);
}
resultGroup.position.y = 0;

Generate code for the following request:
`;

async function generate3DObject(prompt) {
  if (!OPENAI_API_KEY) {
    return {
      success: false,
      error: 'OpenAI API key not configured. Set OPENAI_API_KEY in .env file.',
      code: generateFallbackCode(prompt)
    };
  }

  try {
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: SYSTEM_PROMPT
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.2,
        max_tokens: 1000
      })
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status}`);
    }

    const data = await response.json();
    let code = data.choices[0].message.content.trim();

    code = code.replace(/```javascript\n?/g, '').replace(/```\n?/g, '').trim();

    if (!code.includes('resultGroup')) {
      code = generateFallbackCode(prompt);
    }

    return {
      success: true,
      code,
      model: data.model
    };
  } catch (error) {
    console.error('AI generation error:', error);
    return {
      success: false,
      error: error.message,
      code: generateFallbackCode(prompt)
    };
  }
}

function generateFallbackCode(prompt) {
  const lowerPrompt = prompt.toLowerCase();

  if (lowerPrompt.includes('table') || lowerPrompt.includes('desk')) {
    return `
const resultGroup = new THREE.Group();
const tableMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.7, metalness: 0.1 });
const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 1), tableMaterial);
top.position.y = 1;
top.castShadow = true;
top.receiveShadow = true;
resultGroup.add(top);
const legPositions = [[-0.9, -0.45], [0.9, -0.45], [-0.9, 0.45], [0.9, 0.45]];
for (const [lx, lz] of legPositions) {
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1, 0.1), tableMaterial);
  leg.position.set(lx, 0.5, lz);
  leg.castShadow = true;
  leg.receiveShadow = true;
  resultGroup.add(leg);
}
resultGroup.position.y = 0;
`;
  }

  if (lowerPrompt.includes('chair')) {
    return `
const resultGroup = new THREE.Group();
const chairMaterial = new THREE.MeshStandardMaterial({ color: 0xA0522D, roughness: 0.6, metalness: 0.1 });
const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.6), chairMaterial);
seat.position.y = 0.5;
seat.castShadow = true;
seat.receiveShadow = true;
resultGroup.add(seat);
const back = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.08), chairMaterial);
back.position.set(0, 0.8, -0.26);
back.castShadow = true;
back.receiveShadow = true;
resultGroup.add(back);
const legPositions = [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]];
for (const [lx, lz] of legPositions) {
  const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), chairMaterial);
  leg.position.set(lx, 0.25, lz);
  leg.castShadow = true;
  leg.receiveShadow = true;
  resultGroup.add(leg);
}
resultGroup.position.y = 0;
`;
  }

  if (lowerPrompt.includes('round') && lowerPrompt.includes('table')) {
    return `
const resultGroup = new THREE.Group();
const tableMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.7, metalness: 0.1 });
const top = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.08, 32), tableMaterial);
top.position.y = 1;
top.rotation.x = Math.PI / 2;
top.castShadow = true;
top.receiveShadow = true;
resultGroup.add(top);
const legMaterial = new THREE.MeshStandardMaterial({ color: 0x5D4037, roughness: 0.5, metalness: 0.2 });
const centerLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 1, 16), legMaterial);
centerLeg.position.y = 0.5;
centerLeg.castShadow = true;
centerLeg.receiveShadow = true;
resultGroup.add(centerLeg);
const base = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.08, 32), legMaterial);
base.position.y = 0.04;
base.rotation.x = Math.PI / 2;
base.castShadow = true;
base.receiveShadow = true;
resultGroup.add(base);
resultGroup.position.y = 0;
`;
  }

  if (lowerPrompt.includes('house') || lowerPrompt.includes('building')) {
    return `
const resultGroup = new THREE.Group();
const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xF5DEB3, roughness: 0.9 });
const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x8B0000, roughness: 0.8 });
const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 2), wallMaterial);
body.position.y = 0.75;
body.castShadow = true;
body.receiveShadow = true;
resultGroup.add(body);
const roof = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1, 4), roofMaterial);
roof.position.y = 2;
roof.rotation.y = Math.PI / 4;
roof.castShadow = true;
roof.receiveShadow = true;
resultGroup.add(roof);
const doorMaterial = new THREE.MeshStandardMaterial({ color: 0x4A2511, roughness: 0.7 });
const door = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.8, 0.08), doorMaterial);
door.position.set(0, 0.4, 1.01);
resultGroup.add(door);
resultGroup.position.y = 0;
`;
  }

  return `
const resultGroup = new THREE.Group();
const material = new THREE.MeshStandardMaterial({ color: 0x6366f1, roughness: 0.4, metalness: 0.3 });
const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
mesh.position.y = 0.5;
mesh.castShadow = true;
mesh.receiveShadow = true;
resultGroup.add(mesh);
resultGroup.position.y = 0;
`;
}

function validateCode(code) {
  if (!code || typeof code !== 'string') return false;
  if (!code.includes('THREE')) return false;
  if (!code.includes('resultGroup')) return false;
  if (code.includes('require(') || code.includes('import ')) return false;
  if (code.includes('eval(') || code.includes('Function(')) return false;
  if (code.includes('window.') || code.includes('document.')) return false;
  if (code.includes('fetch(') || code.includes('XMLHttpRequest')) return false;
  return true;
}

function sanitizeCode(code) {
  return code
    .replace(/document\./g, '')
    .replace(/window\./g, '')
    .replace(/eval\(/g, '')
    .replace(/Function\(/g, '')
    .replace(/fetch\(/g, '');
}

module.exports = {
  generate3DObject,
  validateCode,
  sanitizeCode,
  generateFallbackCode
};
