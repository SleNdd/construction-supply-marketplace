'use client';

import Image from 'next/image';
import { useState } from 'react';
import type { Product } from '@/lib/api';

const categoryPhotos = {
  brick: '/images/materials/bricks.jpg',
  tile: '/images/materials/tile-polished.jpg',
  paint: '/images/materials/paint-tools.jpg',
  insulation: '/images/materials/insulation.jpeg',
  wood: '/images/materials/wood-stack.jpg',
} as const;

export function MaterialArt({ product, large = false }: { product: Product; large?: boolean }) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const text = `${product.name} ${typeof product.category === 'string' ? product.category : product.category.name}`.toLowerCase();
  const kind = /кирпич|блок|газобетон/.test(text) ? 'brick' : /плитк|керамогранит/.test(text) ? 'tile' : /краск|грунт|лак/.test(text) ? 'paint' : /утепл|минват|изоляц/.test(text) ? 'insulation' : /доск|брус|пиломатериал|древес/.test(text) ? 'wood' : /труб|кабел|электр/.test(text) ? 'pipe' : /цемент|смес|штукатур|клей|шпаклев/.test(text) ? 'mix' : 'general';
  const productPhoto = product.imageUrl && (/^https:\/\//.test(product.imageUrl) || product.imageUrl.startsWith('/images/')) && product.imageUrl !== failedImage ? product.imageUrl : undefined;
  const photo = productPhoto || categoryPhotos[kind as keyof typeof categoryPhotos];

  if (photo) {
    return <div className={`material-art material-photo${large ? ' large' : ''}`}>
      <Image src={photo} alt={productPhoto ? product.name : `Фото категории «${typeof product.category === 'string' ? product.category : product.category.name}»`} fill unoptimized={Boolean(productPhoto?.startsWith('https://'))} referrerPolicy="no-referrer" onError={productPhoto ? () => setFailedImage(productPhoto) : undefined} sizes={large ? '(max-width: 820px) 100vw, 50vw' : '(max-width: 560px) 100vw, (max-width: 1100px) 50vw, 25vw'} />
      <span className="photo-note">{productPhoto ? 'Фото товара' : 'Фото категории'}</span>
    </div>;
  }

  return <div className={`material-art material-${kind}${large ? ' large' : ''}`} aria-label={`Иллюстрация категории товара: ${product.name}`} role="img"><span className="art-grid"/><span className="art-object a"/><span className="art-object b"/><span className="art-object c"/><span className="art-label">ОМ / {kind.toUpperCase()}</span></div>;
}
