/**
 * Application Store for Certify™ Next.js Workspace
 */

import { create } from 'zustand';
import type {
  Font,
  CsvRow,
  ViewMode,
  EmailSettings,
  EmailProgress,
  TextBox,
} from '../types';

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
};

const generateBoxId = (): string =>
  `box_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

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
  displayScale: number;
  addBox: (box: Omit<TextBox, 'id' | 'field' | 'fontSize' | 'fontColor' | 'fontFamily' | 'hAlign' | 'vAlign'>) => void;
  updateBox: (id: string, updates: Partial<TextBox>) => void;
  deleteBox: (id: string) => void;
  setActiveBox: (id: string | null) => void;
  setDisplayScale: (scale: number) => void;
  setBoxes: (boxes: TextBox[]) => void;

  // CSV Data State
  csvFile: File | null;
  csvHeaders: string[];
  csvData: CsvRow[];
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

  // Global Reset Actions
  reset: () => void;
  resetToDownload: () => void;
}

const initialState = {
  templateFile: null,
  templateImage: null,
  templateInfo: '',
  boxes: [] as TextBox[],
  activeBoxId: null,
  displayScale: 1,
  csvFile: null,
  csvHeaders: [] as string[],
  csvData: [] as CsvRow[],
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
    }),

  clearTemplate: () =>
    set({
      templateFile: null,
      templateImage: null,
      templateInfo: '',
      boxes: [],
      activeBoxId: null,
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

  setDisplayScale: (displayScale) => set({ displayScale }),

  setBoxes: (boxes) => set({ boxes }),

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

      return {
        csvFile: file,
        csvHeaders: headers,
        csvData: data,
        emailColumn: emailCol,
        emailSettings: newEmailSettings,
      };
    });
  },

  clearCsvData: () =>
    set({
      csvFile: null,
      csvHeaders: [],
      csvData: [],
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

  reset: () => set(initialState),

  resetToDownload: () =>
    set({
      viewMode: 'certificate',
      emailProgress: DEFAULT_EMAIL_PROGRESS,
    }),
}));
