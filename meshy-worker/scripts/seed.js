import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import admin from 'firebase-admin';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serviceAccountPath = resolve(__dirname, '../../service-account.json');
const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

const products = [
  {
    title: 'Sofá modular gris 3 puestos',
    description:
      'Sofá tela suave color gris, estructura en madera maciza, ideal para sala de 3 puestos. Vista 3D para previsualizar antes de comprar.',
    price: 1850000,
    category: 'muebles',
    sellerId: 'demo_seller_001',
    sellerName: 'Casa Nube',
    sellerRating: 4.8,
    photos: [
      'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=1200&q=80',
    ],
    status: 'published',
    model3d: {
      status: 'ready',
      glbUrl: 'https://modelviewer.dev/shared-assets/models/Astronaut.glb',
      usdzUrl: 'https://modelviewer.dev/shared-assets/models/Astronaut.usdz',
    },
  },
  {
    title: 'Lámpara decorativa minimalista',
    description:
      'Lámpara estilo nórdico, base de madera y pantalla blanca. Ideal para mesa de noche o escritorio.',
    price: 220000,
    category: 'iluminacion',
    sellerId: 'demo_seller_001',
    sellerName: 'Luz Clara',
    sellerRating: 4.6,
    photos: [
      'https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80',
    ],
    status: 'published',
    model3d: {
      status: 'ready',
      glbUrl: 'https://modelviewer.dev/shared-assets/models/RobotExpressive.glb',
      usdzUrl: null,
    },
  },
  {
    title: 'Casco de astronauta vintage',
    description:
      'Pieza decorativa coleccionable. Réplica detallada con visor reflectante y acabados auténticos.',
    price: 480000,
    category: 'decoracion',
    sellerId: 'demo_seller_001',
    sellerName: 'Galería Orbital',
    sellerRating: 4.9,
    photos: [
      'https://images.unsplash.com/photo-1614728894747-a83421e2b9c9?auto=format&fit=crop&w=1200&q=80',
    ],
    status: 'published',
    model3d: {
      status: 'ready',
      glbUrl: 'https://modelviewer.dev/shared-assets/models/Astronaut.glb',
      usdzUrl: 'https://modelviewer.dev/shared-assets/models/Astronaut.usdz',
    },
  },
];

async function seed() {
  console.log(`Sembrando ${products.length} productos en Firestore...`);

  const batch = db.batch();
  const now = admin.firestore.FieldValue.serverTimestamp();

  for (const product of products) {
    const ref = db.collection('products').doc();
    batch.set(ref, {
      ...product,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`  + ${product.title} (${ref.id})`);
  }

  await batch.commit();
  console.log('Listo.');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Falló el seed:', err);
  process.exit(1);
});
