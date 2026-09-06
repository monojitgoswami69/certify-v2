/**
 * Application Store for Credify™ Next.js Workspace
 */

import { create } from 'zustand';
import type {
  Font,
  CsvRow,
  ViewMode,
  EmailSettings,
  EmailProgress,
  TextBox,
  QrZone,
  ExportFormats,
} from '../types';

export type { QrZone };

const DEFAULT_EMAIL_SETTINGS: EmailSettings = {
  subject: 'Your Certificate is Ready! 🎉',
  bodyPlain: `Hi {{name}},

Congratulations on your achievement!

Please find your certificate attached to this email.

Best regards,
The Team`,
  bodyHtml: '',
  attachPdf: true,
  attachJpg: true,
};

const DEFAULT_EMAIL_PROGRESS: EmailProgress = {
  current: 0,
  total: 0,
  currentRecipient: '',
  status: 'idle',
  errors: [],
  sent: [],
  records: [],
};

function generateBoxId(): string {
  return `box_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

function generateQrId(): string {
  return `qr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
}

interface AppStore {
  // Template State
  templateFile: File | null;
  templateImage: HTMLImageElement | null;
  templateInfo: string;
  setTemplate: (file: File, image: HTMLImageElement, info: string) => void;
  clearTemplate: () => void;

  // Text Boxes State
  boxes: TextBox[];
  activeBoxId: string | null;
  addBox: (box: Omit<TextBox, 'id' | 'field' | 'fontSize' | 'fontColor' | 'fontFamily' | 'hAlign' | 'vAlign'>) => void;
  updateBox: (id: string, updates: Partial<TextBox>) => void;
  deleteBox: (id: string) => void;
  setActiveBox: (id: string | null) => void;
  setBoxes: (boxes: TextBox[]) => void;

  // QR Verification Zones (supports multiple QR codes)
  qrZones: QrZone[];
  activeQrId: string | null;
  isPlacingQr: boolean;
  setIsPlacingQr: (isPlacing: boolean) => void;
  addQrZone: (x: number, y: number, size?: number) => string;
  updateQrZone: (id: string, updates: Partial<QrZone>) => void;
  deleteQrZone: (id: string) => void;
  setActiveQrId: (id: string | null) => void;
  setQrZones: (zones: QrZone[]) => void;
  clearQrZones: () => void;

  // CSV Data & Dedicated Event Name
  csvFile: File | null;
  csvHeaders: string[];
  csvData: CsvRow[];
  eventName: string;
  setEventName: (name: string) => void;
  setCsvData: (file: File, headers: string[], data: CsvRow[]) => void;
  clearCsvData: () => void;

  // Email Column Selection
  emailColumn: string;
  setEmailColumn: (column: string) => void;

  // Defaults for new boxes
  defaultFont: string;
  defaultFontSize: number;
  defaultFontColor: string;
  setDefaultFont: (font: string) => void;
  setDefaultFontSize: (size: number) => void;
  setDefaultFontColor: (color: string) => void;

  // Preview & Font Hover
  previewEnabled: boolean;
  setPreviewEnabled: (enabled: boolean) => void;
  fontPreview: { boxId: string; fontFamily: string } | null;
  setFontPreview: (preview: { boxId: string; fontFamily: string } | null) => void;

  // UI State
  viewMode: ViewMode;
  error: string | null;
  sidebarWidth: number;
  setViewMode: (mode: ViewMode) => void;
  setError: (error: string | null) => void;
  setSidebarWidth: (width: number) => void;

  // Fonts
  fonts: Font[];
  setFonts: (fonts: Font[]) => void;

  // Email Mode State
  emailSettings: EmailSettings;
  emailProgress: EmailProgress;
  setEmailSettings: (settings: Partial<EmailSettings>) => void;
  setEmailProgress: (progress: Partial<EmailProgress>) => void;
  resetEmailProgress: () => void;

  // Connected Google Account State
  connectedGoogleAccount: { email: string; name?: string; accessToken?: string } | null;
  setConnectedGoogleAccount: (account: { email: string; name?: string; accessToken?: string } | null) => void;

  // Direct Certificate Export Formats
  exportFormats: ExportFormats;
  setExportFormats: (formats: Partial<ExportFormats>) => void;

  // Global Reset Actions
  reset: () => void;
  resetToDownload: () => void;
}

const initialState = {
  templateFile: null,
  templateImage: null,
  templateInfo: '',
  boxes: [] as TextBox[],
  activeBoxId: null as string | null,
  qrZones: [] as QrZone[],
  activeQrId: null as string | null,
  isPlacingQr: false,
  csvFile: null,
  csvHeaders: [] as string[],
  csvData: [] as CsvRow[],
  eventName: '',
  emailColumn: '',
  defaultFont: '',
  defaultFontSize: 60,
  defaultFontColor: '#000000',
  previewEnabled: true,
  fontPreview: null,
  viewMode: 'certificate' as ViewMode,
  sidebarWidth: 420,
  error: null,
  fonts: [] as Font[],
  exportFormats: {
    png: true,
    jpg: false,
    pdf: true,
  } as ExportFormats,
  emailSettings: DEFAULT_EMAIL_SETTINGS,
  emailProgress: DEFAULT_EMAIL_PROGRESS,
  connectedGoogleAccount: null,
};

export const useAppStore = create<AppStore>((set, get) => ({
  ...initialState,

  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  setConnectedGoogleAccount: (account) => set({ connectedGoogleAccount: account }),

  setTemplate: (file, image, info) =>
    set({
      templateFile: file,
      templateImage: image,
      templateInfo: info,
      boxes: [],
      activeBoxId: null,
      qrZones: [],
      activeQrId: null,
      isPlacingQr: false,
    }),

  clearTemplate: () =>
    set({
      templateFile: null,
      templateImage: null,
      templateInfo: '',
      boxes: [],
      activeBoxId: null,
      qrZones: [],
      activeQrId: null,
      isPlacingQr: false,
    }),

  addBox: (boxData) => {
    const { defaultFont, defaultFontSize, defaultFontColor, csvHeaders } = get();
    const newBox: TextBox = {
      id: generateBoxId(),
      ...boxData,
      field: csvHeaders[0] || '',
      fontSize: defaultFontSize,
      fontColor: defaultFontColor,
      fontFamily: defaultFont || 'Inter',
      hAlign: 'center',
      vAlign: 'bottom',
    };
    set((state) => ({
      boxes: [...state.boxes, newBox],
      activeBoxId: newBox.id,
    }));
  },

  updateBox: (id, updates) =>
    set((state) => ({
      boxes: state.boxes.map((box) => (box.id === id ? { ...box, ...updates } : box)),
    })),

  deleteBox: (id) =>
    set((state) => ({
      boxes: state.boxes.filter((box) => box.id !== id),
      activeBoxId: state.activeBoxId === id ? null : state.activeBoxId,
    })),

  setActiveBox: (activeBoxId) => set({ activeBoxId }),

  setBoxes: (boxes) => set({ boxes }),

  setIsPlacingQr: (isPlacingQr) =>
    set({
      isPlacingQr,
      activeBoxId: isPlacingQr ? null : get().activeBoxId,
      activeQrId: isPlacingQr ? null : get().activeQrId,
    }),

  addQrZone: (x, y, size) => {
    const { templateImage, qrZones } = get();
    const defaultSize =
      size ||
      (templateImage
        ? Math.round(Math.min(templateImage.width, templateImage.height) * 0.15)
        : 180);
    const id = generateQrId();
    const newZone: QrZone = {
      id,
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
      size: defaultSize,
    };
    const updated = [...qrZones, newZone];
    set({
      qrZones: updated,
      activeQrId: id,
      isPlacingQr: false,
      activeBoxId: null,
    });
    return id;
  },

  updateQrZone: (id, updates) =>
    set((state) => ({
      qrZones: state.qrZones.map((zone) =>
        zone.id === id ? { ...zone, ...updates } : zone
      ),
    })),

  deleteQrZone: (id) =>
    set((state) => ({
      qrZones: state.qrZones.filter((zone) => zone.id !== id),
      activeQrId: state.activeQrId === id ? null : state.activeQrId,
    })),

  setActiveQrId: (activeQrId) =>
    set((state) => ({
      activeQrId,
      activeBoxId: activeQrId ? null : state.activeBoxId,
    })),

  setQrZones: (qrZones) => set({ qrZones }),

  clearQrZones: () =>
    set({
      qrZones: [],
      activeQrId: null,
      isPlacingQr: false,
    }),

  setCsvData: (file, headers, data) => {
    const emailCol =
      headers.find((h) => h.toLowerCase().includes('email') || h.toLowerCase().includes('mail')) ||
      '';

    const nameCol = headers.find(
      (h) =>
        h.toLowerCase() === 'name' ||
        h.toLowerCase().includes('name') ||
        h.toLowerCase().includes('student') ||
        h.toLowerCase().includes('participant') ||
        h.toLowerCase().includes('receiver')
    );

    set((state) => {
      const newEmailSettings = { ...state.emailSettings };
      if (
        nameCol &&
        (newEmailSettings.bodyPlain.includes('{{name}}') ||
          newEmailSettings.bodyPlain.includes('{{Name}}'))
      ) {
        if (nameCol !== 'name') {
          newEmailSettings.bodyPlain = newEmailSettings.bodyPlain.replace(
            /{{name}}/gi,
            `{{${nameCol}}}`
          );
          newEmailSettings.bodyHtml = newEmailSettings.bodyHtml.replace(
            /{{name}}/gi,
            `{{${nameCol}}}`
          );
        }
      }

      const defaultEventName = file.name
        ? file.name.replace(/\.[^/.]+$/, '').replace(/[_-]+/g, ' ').trim().replace(/\b\w/g, (l) => l.toUpperCase())
        : '';

      return {
        csvFile: file,
        csvHeaders: headers,
        csvData: data,
        eventName: state.eventName || defaultEventName || 'General Event',
        emailColumn: emailCol,
        emailSettings: newEmailSettings,
      };
    });
  },

  setEventName: (eventName) => set({ eventName }),

  clearCsvData: () =>
    set({
      csvFile: null,
      csvHeaders: [],
      csvData: [],
      eventName: '',
      emailColumn: '',
    }),

  setEmailColumn: (emailColumn) => set({ emailColumn }),

  setDefaultFont: (defaultFont) => set({ defaultFont }),
  setDefaultFontSize: (defaultFontSize) => set({ defaultFontSize }),
  setDefaultFontColor: (defaultFontColor) => set({ defaultFontColor }),

  setPreviewEnabled: (previewEnabled) => set({ previewEnabled }),
  setFontPreview: (fontPreview) => set({ fontPreview }),

  setViewMode: (viewMode) => set({ viewMode }),
  setError: (error) => set({ error }),

  setFonts: (fonts) => {
    const defaultFont = fonts.length > 0 ? fonts[0].family : 'Inter';
    set((state) => ({
      fonts,
      defaultFont,
      boxes: state.boxes.map((box) =>
        !box.fontFamily && defaultFont ? { ...box, fontFamily: defaultFont } : box
      ),
    }));
  },

  setEmailSettings: (settings) =>
    set((state) => ({
      emailSettings: { ...state.emailSettings, ...settings },
    })),

  setEmailProgress: (progress) =>
    set((state) => ({
      emailProgress: { ...state.emailProgress, ...progress },
    })),

  resetEmailProgress: () => set({ emailProgress: DEFAULT_EMAIL_PROGRESS }),

  setExportFormats: (formats) =>
    set((state) => ({
      exportFormats: { ...state.exportFormats, ...formats },
    })),

  reset: () => set(initialState),

  resetToDownload: () =>
    set({
      viewMode: 'certificate',
      emailProgress: DEFAULT_EMAIL_PROGRESS,
    }),
}));
