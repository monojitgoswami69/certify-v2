'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ConfettiPiece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  width: number;
  height: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  wobble: number;
  wobbleSpeed: number;
  shape: 'rect' | 'circle' | 'strip' | 'diamond';
}

const PALETTE = [
  '#10B981', // Emerald
  '#059669', // Deep emerald
  '#34D399', // Mint emerald
  '#F59E0B', // Warm gold
  '#D97706', // Champagne gold
  '#6366F1', // Royal indigo
  '#64748B', // Slate
  '#0F172A', // Obsidian
  '#FCD34D', // Light gold
];

export function ConfettiCanvas({
  trigger = true,
  onComplete,
}: {
  trigger?: boolean;
  onComplete?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !trigger) return;
    if (typeof window === 'undefined') return;

    // Honor reduced motion accessibility preference
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onComplete?.();
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let width = (canvas.width = window.innerWidth);
    let height = (canvas.height = window.innerHeight);

    const handleResize = () => {
      if (!canvas) return;
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    // Burst origin from the true bottom-left corner of the browser viewport/window
    const originX = 0;
    const originY = height;

    const particleCount = Math.min(105, Math.max(60, Math.floor(width / 13)));
    const particles: ConfettiPiece[] = [];

    for (let i = 0; i < particleCount; i++) {
      // Angle shooting upward and rightward across the viewport: ~20° to 70°
      const angle = 0.35 + Math.random() * 0.82;
      const speed = 16 + Math.random() * 16;
      const shapeRand = Math.random();

      particles.push({
        x: originX + Math.random() * 25,
        y: originY - Math.random() * 15,
        vx: Math.cos(angle) * speed * (0.85 + Math.random() * 0.3),
        vy: -Math.sin(angle) * speed,
        gravity: 0.28 + Math.random() * 0.08,
        drag: 0.985,
        width: 7 + Math.random() * 6,
        height: 5 + Math.random() * 5,
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.25,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.09 + Math.random() * 0.07,
        shape:
          shapeRand > 0.8
            ? 'diamond'
            : shapeRand > 0.6
            ? 'circle'
            : shapeRand > 0.35
            ? 'strip'
            : 'rect',
      });
    }

    const startTime = performance.now();
    const DURATION = 3600; // 3.6 seconds for complete graceful arc

    const render = (now: number) => {
      const elapsed = now - startTime;
      if (elapsed >= DURATION) {
        ctx.clearRect(0, 0, width, height);
        onComplete?.();
        return;
      }

      // Smooth ease-out fade starting at 2.0s
      let alpha = 1;
      if (elapsed > 2000) {
        const progress = (elapsed - 2000) / (DURATION - 2000);
        alpha = Math.max(0, 1 - Math.pow(progress, 1.5));
      }

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.globalAlpha = alpha;

      for (const p of particles) {
        p.vx *= p.drag;
        p.vy = p.vy * p.drag + p.gravity;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;
        p.wobble += p.wobbleSpeed;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        // Genuine 3D paper flutter simulation by scaling the X axis via cosine
        ctx.scale(Math.cos(p.wobble), 1);
        ctx.fillStyle = p.color;

        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.width / 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.shape === 'diamond') {
          ctx.beginPath();
          ctx.moveTo(0, -p.height);
          ctx.lineTo(p.width * 0.7, 0);
          ctx.lineTo(0, p.height);
          ctx.lineTo(-p.width * 0.7, 0);
          ctx.closePath();
          ctx.fill();
        } else if (p.shape === 'strip') {
          ctx.fillRect(-p.width / 2, -p.height * 1.6, p.width * 0.55, p.height * 3.2);
        } else {
          ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height);
        }

        ctx.restore();
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, [mounted, trigger, onComplete]);

  if (!mounted || !trigger) return null;

  return createPortal(
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-[99999]"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 99999,
      }}
      aria-hidden="true"
    />,
    document.body
  );
}
