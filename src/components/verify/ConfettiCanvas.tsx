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
  delay: number;
  seed: number;
  shape: 'rect' | 'circle' | 'strip' | 'diamond';
}

const PALETTE = [
  '#10B981', // Emerald
  '#059669', // Deep emerald
  '#34D399', // Mint emerald
  '#F59E0B', // Warm gold
  '#D97706', // Champagne gold
  '#FCD34D', // Light gold
  '#6366F1', // Royal indigo
  '#64748B', // Slate
  '#0F172A', // Obsidian
  '#F1F5F9', // Crisp platinum
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

    // Balanced dual-cannon emitters (bottom-left and bottom-right)
    // Cross-fires upward and toward the center across the verified credential
    const totalCount = Math.min(130, Math.max(75, Math.floor(width / 11)));
    const particles: ConfettiPiece[] = [];

    for (let i = 0; i < totalCount; i++) {
      // Alternate cannons: even index from bottom-left, odd index from bottom-right
      const isLeft = i % 2 === 0;

      // Broad launch muzzle spread (60px) prevents particles from stacking in a clump
      const originX = isLeft
        ? Math.max(20, width * 0.05) + (Math.random() - 0.5) * 60
        : Math.min(width - 20, width * 0.95) + (Math.random() - 0.5) * 60;
      const originY = height + 10 + (Math.random() - 0.5) * 25;

      // Trajectory angle:
      // Left cannon fires ~55° up-right; Right cannon fires ~125° up-left
      const baseAngle = isLeft ? Math.PI * 0.32 : Math.PI * 0.68;
      const angle = baseAngle + (Math.random() - 0.5) * 0.42;

      // Speed distribution creates rich vertical depth (some shoot high, some flutter mid-air)
      const speed = 17 + Math.random() * 15;
      const shapeRand = Math.random();

      // Time-staggered launch (0ms to 240ms) streams particles like a real party cannon
      const delay = Math.random() * 240;

      particles.push({
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed,
        vy: -Math.sin(angle) * speed,
        gravity: 0.3 + Math.random() * 0.08,
        drag: 0.983,
        width: 7 + Math.random() * 6,
        height: 5 + Math.random() * 6,
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 0.22,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.08 + Math.random() * 0.08,
        delay,
        seed: Math.random() * 1000,
        shape:
          shapeRand > 0.8
            ? 'diamond'
            : shapeRand > 0.62
            ? 'circle'
            : shapeRand > 0.35
            ? 'strip'
            : 'rect',
      });
    }

    const startTime = performance.now();
    const DURATION = 3800; // 3.8 seconds for complete graceful cascade

    const render = (now: number) => {
      const elapsed = now - startTime;
      if (elapsed >= DURATION) {
        ctx.clearRect(0, 0, width, height);
        onComplete?.();
        return;
      }

      // Smooth ease-out fade starting at 2.2s
      let alpha = 1;
      if (elapsed > 2200) {
        const progress = (elapsed - 2200) / (DURATION - 2200);
        alpha = Math.max(0, 1 - Math.pow(progress, 1.5));
      }

      ctx.clearRect(0, 0, width, height);
      ctx.save();
      ctx.globalAlpha = alpha;

      for (const p of particles) {
        // Particle has not launched yet -> skip rendering (eliminates starting clump!)
        if (elapsed < p.delay) continue;

        const age = elapsed - p.delay;

        p.vx *= p.drag;
        p.vy = p.vy * p.drag + p.gravity;
        // Subtle aerodynamic lateral air drift
        p.x += p.vx + Math.sin((age + p.seed) * 0.0035) * 0.55;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;
        p.wobble += p.wobbleSpeed;

        // Smooth scale-in over initial 60ms prevents sudden pop-in at the muzzle
        const scaleIn = Math.min(1, age / 60);

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        // Genuine 3D paper flutter simulation by scaling the X axis via cosine
        ctx.scale(Math.cos(p.wobble) * scaleIn, scaleIn);
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
