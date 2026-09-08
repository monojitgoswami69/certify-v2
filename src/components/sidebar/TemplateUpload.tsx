'use client';

import { useCallback, useEffect } from 'react';
import { Upload } from 'lucide-react';
import { useAppStore } from '../../store/useAppStore';

function createSampleTemplate(): Promise<{ file: File; img: HTMLImageElement; info: string }> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext('2d')!;

    // Elegant certificate background
    const bgGrad = ctx.createLinearGradient(0, 0, 1920, 1080);
    bgGrad.addColorStop(0, '#fdfbf7');
    bgGrad.addColorStop(1, '#f4efe6');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1920, 1080);

    // Ornate gold/slate border
    ctx.strokeStyle = '#c79d4c';
    ctx.lineWidth = 14;
    ctx.strokeRect(36, 36, 1920 - 72, 1080 - 72);

    ctx.strokeStyle = '#1e293b';
    ctx.lineWidth = 3;
    ctx.strokeRect(54, 54, 1920 - 108, 1080 - 108);

    // Certificate Header
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 54px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('CERTIFICATE OF ACHIEVEMENT', 960, 220);

    ctx.font = '22px system-ui, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('THIS CERTIFICATE IS PROUDLY PRESENTED TO', 960, 310);

    // Placeholder line for Name
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(480, 520);
    ctx.lineTo(1440, 520);
    ctx.stroke();

    ctx.font = '20px system-ui, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('for exceptional performance and active participation in the event.', 960, 600);

    // Signature lines
    ctx.beginPath();
    ctx.moveTo(320, 880);
    ctx.lineTo(680, 880);
    ctx.moveTo(1240, 880);
    ctx.lineTo(1600, 880);
    ctx.stroke();

    ctx.font = '16px system-ui, sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('ORGANIZER SIGNATURE', 500, 915);
    ctx.fillText('VERIFIED CREDENTIAL', 1420, 915);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], 'sample-certificate.png', { type: 'image/png' });
      const img = new Image();
      img.onload = () => {
        resolve({
          file,
          img,
          info: `sample-certificate.png (${img.width}×${img.height})`,
        });
      };
      img.src = canvas.toDataURL('image/png');
    }, 'image/png');
  });
}

export function TemplateUpload() {
  const { setTemplate } = useAppStore();

  const handleFile = useCallback(
    (file: File) => {
      if (!file || !file.type.startsWith('image/')) return;

      const objectUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const info = `${file.name} (${img.width}×${img.height})`;
        setTemplate(file, img, info);
      };
      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
      };
      img.src = objectUrl;
    },
    [setTemplate]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = '';
    },
    [handleFile]
  );

  const handleUseSample = useCallback(async () => {
    const { file, img, info } = await createSampleTemplate();
    setTemplate(file, img, info);
  }, [setTemplate]);

  // Expose as an internal function on window for programmatic testing
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as unknown as { __loadSampleTemplate?: () => Promise<void> }).__loadSampleTemplate = handleUseSample;
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as unknown as { __loadSampleTemplate?: () => Promise<void> }).__loadSampleTemplate;
      }
    };
  }, [handleUseSample]);

  return (
    <label
      className="flex flex-col items-center justify-center gap-3 p-6 border-2 border-dashed border-slate-300 rounded-xl cursor-pointer hover:border-primary-400 hover:bg-primary-50/20 transition-colors"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <input type="file" accept="image/*" className="hidden" onChange={handleChange} />
      <Upload className="w-8 h-8 text-slate-400" />
      <div className="text-center">
        <p className="text-sm text-slate-600">
          Drag & drop or <span className="text-primary-600 font-medium">browse</span>
        </p>
        <p className="text-xs text-slate-400 mt-1">Supports JPG, PNG, WebP</p>
      </div>
    </label>
  );
}
