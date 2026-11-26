/**
 * Application Store for WeCertify™ Next.js Workspace
 */

import { create } from 'zustand';
import { defaultCertificateFontSize } from '../lib/certificate-text';
import { cleanCsvRows, type CsvReviewMetadata } from '../lib/csv-parser';
import type {
  Font,
  CsvRow,
  ViewMode,
  EmailSettings,
  EmailProgress,
  TextBox,
  QrZone,
  ImageElement,
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

function generateImageId(): string {
  return `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
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

  // Static text boxes reuse the TextBox shape with kind='static'
  addStaticTextBox: (box: Omit<TextBox, 'id' | 'field' | 'fontSize' | 'fontColor' | 'fontFamily' | 'hAlign' | 'vAlign' | 'kind' | 'staticText'>) => void;

  // Decorative image elements (logos, signatures, seals)
  images: ImageElement[];
  activeImageId: string | null;
  addImage: (image: Omit<ImageElement, 'id'>) => void;
  updateImage: (id: string, updates: Partial<ImageElement>) => void;
  deleteImage: (id: string) => void;
  setActiveImage: (id: string | null) => void;
  setImages: (images: ImageElement[]) => void;

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
  csvReview: CsvReviewMetadata;
  eventName: string;
  eventLabel: string;
  registrationEventId: string | null;
  issuanceStarted: boolean;
  setEventLabel: (label: string) => void;
  setEventName: (name: string) => void;
  setCsvData: (file: File, headers: string[], data: CsvRow[], review?: CsvReviewMetadata) => void;
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
  connectedGoogleAccount: { email: string; name?: string; picture?: string } | null;
  setConnectedGoogleAccount: (account: { email: string; name?: string; picture?: string } | null) => void;

  // Direct Certificate Export Formats
  exportFormats: ExportFormats;
  setExportFormats: (formats: Partial<ExportFormats>) => void;

  // Batch Registration State
  isBatchRegistered: boolean;
  registeredCertIds: Map<number, string>;
  verificationOrigin: string | null;
  registeredAt: string | null;
  isBatchRegistering: boolean;
  batchRegistrationError: string | null;
  registrationDirty: boolean;
  setBatchRegistered: (registered: boolean, ids?: Map<number, string>) => void;
  setIsBatchRegistering: (isRegistering: boolean) => void;
  setBatchRegistrationError: (error: string | null) => void;
  setRegistrationDirty: (dirty: boolean) => void;
  clearBatchRegistration: () => void;

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
  images: [] as ImageElement[],
  activeImageId: null as string | null,
  qrZones: [] as QrZone[],
  activeQrId: null as string | null,
  isPlacingQr: false,
  csvFile: null,
  csvHeaders: [] as string[],
  csvData: [] as CsvRow[],
  csvReview: { numbers: [], ignored: [] } as CsvReviewMetadata,
  eventName: '',
  eventLabel: '',
  registrationEventId: null,
  issuanceStarted: false,
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
    pdf: false,
  } as ExportFormats,
  emailSettings: DEFAULT_EMAIL_SETTINGS,
  emailProgress: DEFAULT_EMAIL_PROGRESS,
  connectedGoogleAccount: null,
  isBatchRegistered: false,
  registeredCertIds: new Map<number, string>(),
  verificationOrigin: null,
  registeredAt: null as string | null,
  isBatchRegistering: false,
  batchRegistrationError: null as string | null,
  registrationDirty: false,
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
      defaultFontSize: defaultCertificateFontSize(image.naturalWidth || image.width, image.naturalHeight || image.height),
      boxes: [],
      activeBoxId: null,
      images: [],
      activeImageId: null,
      qrZones: [],
      activeQrId: null,
      isPlacingQr: false,
      isBatchRegistered: false,
      registeredCertIds: new Map<number, string>(),
      verificationOrigin: null,
      registeredAt: null,
      isBatchRegistering: false,
      batchRegistrationError: null,
      registrationDirty: false,
    }),

  clearTemplate: () =>
    set({
      templateFile: null,
      templateImage: null,
      templateInfo: '',
      boxes: [],
      activeBoxId: null,
      images: [],
      activeImageId: null,
      qrZones: [],
      activeQrId: null,
      isPlacingQr: false,
      isBatchRegistered: false,
      registeredCertIds: new Map<number, string>(),
      verificationOrigin: null,
      registeredAt: null,
      isBatchRegistering: false,
      batchRegistrationError: null,
      registrationDirty: false,
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
      registrationDirty: state.isBatchRegistered ? true : state.registrationDirty,
    }));
  },

  updateBox: (id, updates) =>
    set((state) => ({
      boxes: state.boxes.map((box) => (box.id === id ? { ...box, ...updates } : box)),
      registrationDirty: state.isBatchRegistered ? true : state.registrationDirty,
    })),

  deleteBox: (id) =>
    set((state) => ({
      boxes: state.boxes.filter((box) => box.id !== id),
      activeBoxId: state.activeBoxId === id ? null : state.activeBoxId,
      registrationDirty: state.isBatchRegistered ? true : state.registrationDirty,
    })),

  setActiveBox: (activeBoxId) =>
    set((state) => ({
      activeBoxId,
      activeQrId: activeBoxId ? null : state.activeQrId,
    })),

  setBoxes: (boxes) =>
    set((state) => ({
      boxes,
      registrationDirty: state.isBatchRegistered ? true : state.registrationDirty,
    })),

  addStaticTextBox: (boxData) => {
    const { defaultFont, defaultFontSize, defaultFontColor } = get();
    const newBox: TextBox = {
      id: generateBoxId(),
      ...boxData,
      field: '',
      kind: 'static',
      staticText: 'Text',
      fontSize: defaultFontSize,
      fontColor: defaultFontColor,
      fontFamily: defaultFont || 'Inter',
      hAlign: 'center',
      vAlign: 'bottom',
    };
    set((state) => ({
      boxes: [...state.boxes, newBox],
      activeBoxId: newBox.id,
      registrationDirty: state.isBatchRegistered ? true : state.registrationDirty,
    }));
  },

  addImage: (imageData) => {
    const newImage: ImageElement = { id: generateImageId(), ...imageData };
    set((state) => ({
      images: [...state.images, newImage],
      activeImageId: newImage.id,
      registrationDirty: state.isBatchRegistered ? true : state.registrationDirty,
    }));
  },

  updateImage: (id, updates) =>
    set((state) => ({
      images: state.images.map((img) => (img.id === id ? { ...img, ...updates } : img)),
      registrationDirty: state.isBatchRegistered ? true : state.registrationDirty,
    })),

  deleteImage: (id) =>
    set((state) => ({
      images: state.images.filter((img) => img.id !== id),
      activeImageId: state.activeImageId === id ? null : state.activeImageId,
      registrationDirty: state.isBatchRegistered ? true : state.registrationDirty,
    })),

  setActiveImage: (activeImageId) =>
    set((state) => ({
      activeImageId,
      activeBoxId: activeImageId ? null : state.activeBoxId,
      activeQrId: activeImageId ? null : state.activeQrId,
    })),

  setImages: (images) =>
    set((state) => ({
      images,
      registrationDirty: state.isBatchRegistered ? true : state.registrationDirty,
    })),

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
      style: {
        bodyShape: 'smooth',
        eyeFrameShape: 'rounded',
        eyeDotShape: 'rounded',
        patternColor: '#000000',
        backgroundColor: 'transparent',
        centerShape: 'rounded',
      },
    };
    const updated = [...qrZones, newZone];
    set((state) => ({
      qrZones: updated,
      activeQrId: id,
      isPlacingQr: false,
      activeBoxId: null,
      registrationDirty: state.isBatchRegistered ? true : state.registrationDirty,
    }));
    return id;
  },

  updateQrZone: (id, updates) =>
    set((state) => ({
      qrZones: state.qrZones.map((zone) =>
        zone.id === id ? { ...zone, ...updates } : zone
      ),
      registrationDirty: state.isBatchRegistered ? true : state.registrationDirty,
    })),

  deleteQrZone: (id) =>
    set((state) => ({
      qrZones: state.qrZones.filter((zone) => zone.id !== id),
      activeQrId: state.activeQrId === id ? null : state.activeQrId,
      registrationDirty: state.isBatchRegistered ? true : state.registrationDirty,
    })),

  setActiveQrId: (activeQrId) =>
    set((state) => ({
      activeQrId,
      activeBoxId: activeQrId ? null : state.activeBoxId,
    })),

  setQrZones: (qrZones) =>
    set((state) => ({
      qrZones,
      registrationDirty: state.isBatchRegistered ? true : state.registrationDirty,
    })),

  clearQrZones: () =>
    set((state) => ({
      qrZones: [],
      activeQrId: null,
      isPlacingQr: false,
      registrationDirty: state.isBatchRegistered ? true : state.registrationDirty,
    })),

  setCsvData: (file, headers, data, review) => {
    const cleaned = Array.isArray(review?.numbers) && review.numbers.length === data.length
      && review.numbers.every((number, index, numbers) => Number.isSafeInteger(number) && number > (numbers[index - 1] ?? 1))
      && Array.isArray(review.ignored) ? { data, review } : cleanCsvRows(data);
    const lower = (h: string) => h.trim().toLowerCase();
    const emailCol =
      headers.find((h) => ['email', 'e-mail', 'email address'].includes(lower(h))) ||
      headers.find((h) => lower(h).includes('email')) ||
      headers.find((h) => lower(h).includes('mail')) ||
      '';

    // Prefer exact recipient-name headers; skip look-alikes such as "Filename" or "Event Name"
    const NON_PERSON_NAME = /(file|base|user|event|course|company|org|school|college|team|host|domain|program)\s*_?name/;
    const nameCol =
      headers.find((h) => ['name', 'full name', 'fullname', 'recipient name', 'participant name', 'student name'].includes(lower(h))) ||
      headers.find((h) => lower(h).includes('name') && !NON_PERSON_NAME.test(lower(h))) ||
      headers.find((h) => /student|participant|receiver|recipient/.test(lower(h)));

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
        csvData: cleaned.data,
        csvReview: cleaned.review,
        eventName: state.eventName || defaultEventName || 'General Event',
        emailColumn: emailCol,
        emailSettings: newEmailSettings,
        isBatchRegistered: false,
        registeredCertIds: new Map<number, string>(),
        verificationOrigin: null,
        registeredAt: null,
        isBatchRegistering: false,
        batchRegistrationError: null,
        registrationDirty: false,
      };
    });
  },

  setEventLabel: (eventLabel) => set({ eventLabel }),

  setEventName: (eventName) =>
    set((state) => ({
      eventName,
      registrationDirty: state.isBatchRegistered ? true : state.registrationDirty,
    })),

  clearCsvData: () =>
    set({
      csvFile: null,
      csvHeaders: [],
      csvData: [],
      csvReview: { numbers: [], ignored: [] },
      eventName: '',
      emailColumn: '',
      isBatchRegistered: false,
      registeredCertIds: new Map<number, string>(),
      verificationOrigin: null,
      registeredAt: null,
      isBatchRegistering: false,
      batchRegistrationError: null,
      registrationDirty: false,
    }),

  setEmailColumn: (emailColumn) =>
    set((state) => ({
      emailColumn,
      registrationDirty:
        state.isBatchRegistered && emailColumn !== state.emailColumn ? true : state.registrationDirty,
    })),

  setDefaultFont: (defaultFont) => set({ defaultFont }),
  setDefaultFontSize: (defaultFontSize) => set({ defaultFontSize }),
  setDefaultFontColor: (defaultFontColor) => set({ defaultFontColor }),

  setPreviewEnabled: (previewEnabled) => set({ previewEnabled }),
  setFontPreview: (fontPreview) => set({ fontPreview }),

  setViewMode: (viewMode) => set({ viewMode }),
  setError: (error) => set({ error }),

  setFonts: (fonts) => {
    set((state) => {
      // Preserve current defaultFont if valid; otherwise default to 'Inter' or first font
      const preferred =
        state.defaultFont && fonts.some((f) => f.family === state.defaultFont)
          ? state.defaultFont
          : fonts.some((f) => f.family === 'Inter')
          ? 'Inter'
          : fonts[0]?.family || 'Inter';

      return {
        fonts,
        defaultFont: preferred,
        boxes: state.boxes.map((box) =>
          !box.fontFamily ? { ...box, fontFamily: preferred } : box
        ),
      };
    });
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

  setBatchRegistered: (isBatchRegistered, ids) =>
    set((state) => ({
      isBatchRegistered,
      registeredCertIds: ids !== undefined ? new Map(ids) : state.registeredCertIds,
      registeredAt: isBatchRegistered ? new Date().toISOString() : null,
      registrationDirty: false,
      batchRegistrationError: null,
    })),

  setIsBatchRegistering: (isBatchRegistering) => set({ isBatchRegistering }),

  setBatchRegistrationError: (batchRegistrationError) => set({ batchRegistrationError }),

  setRegistrationDirty: (registrationDirty) => set({ registrationDirty }),

  clearBatchRegistration: () =>
    set({
      isBatchRegistered: false,
      registeredCertIds: new Map<number, string>(),
      verificationOrigin: null,
      registeredAt: null,
      isBatchRegistering: false,
      batchRegistrationError: null,
      registrationDirty: false,
    }),

  reset: () =>
    set((state) => ({
      ...initialState,
      fonts: state.fonts.length > 0 ? state.fonts : initialState.fonts,
      sidebarWidth: state.sidebarWidth || initialState.sidebarWidth,
      connectedGoogleAccount: state.connectedGoogleAccount,
    })),

  resetToDownload: () =>
    set({
      viewMode: 'certificate',
      emailProgress: DEFAULT_EMAIL_PROGRESS,
    }),
}));
