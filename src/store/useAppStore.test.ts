import { beforeEach, describe, expect, it } from 'vitest';
import { useAppStore } from './useAppStore';
import { useHistoryStore } from './useHistoryStore';

describe('useAppStore & useHistoryStore', () => {
  beforeEach(() => {
    useAppStore.getState().reset();
    useHistoryStore.getState().clearHistory();
  });

  it('starts with unselected download export formats and PDF+PNG mail attachments', () => {
    const state = useAppStore.getState();
    expect(state.exportFormats).toEqual({ png: false, jpg: false, pdf: false });
    expect(state.emailSettings.attachPdf).toBe(true);
    expect(state.emailSettings.attachPng).toBe(true);
    expect(state.emailSettings.attachJpg).toBe(false);
  });

  it('enforces mutually exclusive active selections across text boxes, QR zones, images, and placement mode', () => {
    const store = useAppStore.getState();
    store.addBox({ x: 10, y: 10, w: 120, h: 40 });
    const boxId = useAppStore.getState().activeBoxId;
    expect(boxId).toBeTruthy();

    const qrId = useAppStore.getState().addQrZone(200, 200, 120);
    expect(useAppStore.getState().activeQrId).toBe(qrId);
    expect(useAppStore.getState().activeBoxId).toBeNull();
    expect(useAppStore.getState().activeImageId).toBeNull();
    expect(useAppStore.getState().isPlacingQr).toBe(false);

    useAppStore.getState().addImage({ x: 50, y: 50, w: 80, h: 80, src: 'data:image/png;base64,iVBORw0KGgo=' });
    const imgId = useAppStore.getState().activeImageId;
    expect(imgId).toBeTruthy();
    expect(useAppStore.getState().activeQrId).toBeNull();
    expect(useAppStore.getState().activeBoxId).toBeNull();

    useAppStore.getState().setIsPlacingQr(true);
    expect(useAppStore.getState().isPlacingQr).toBe(true);
    expect(useAppStore.getState().activeImageId).toBeNull();

    useAppStore.getState().setActiveBox(boxId);
    expect(useAppStore.getState().activeBoxId).toBe(boxId);
    expect(useAppStore.getState().isPlacingQr).toBe(false);
    expect(useAppStore.getState().activeQrId).toBeNull();
    expect(useAppStore.getState().activeImageId).toBeNull();
  });

  it('resets issuance state on template replacement/clear and clears unissued event IDs on clearCsvData', () => {
    const file = new File(['png'], 'template.png', { type: 'image/png' });
    const img = { naturalWidth: 1600, naturalHeight: 1200, width: 1600, height: 1200 } as unknown as HTMLImageElement;

    useAppStore.setState({
      registrationEventId: 'evt-1',
      issuanceStarted: true,
      isBatchRegistered: true,
      registrationDirty: true,
    });

    useAppStore.getState().setTemplate(file, img, 'template.png (1600x1200)');
    expect(useAppStore.getState().registrationEventId).toBeNull();
    expect(useAppStore.getState().issuanceStarted).toBe(false);
    expect(useAppStore.getState().isBatchRegistered).toBe(false);
    expect(useAppStore.getState().boxes).toEqual([]);
    expect(useAppStore.getState().qrZones).toEqual([]);
    expect(useAppStore.getState().images).toEqual([]);

    // Unissued batch clears registrationEventId on clearCsvData
    useAppStore.setState({ registrationEventId: 'evt-draft', issuanceStarted: false });
    useAppStore.getState().clearCsvData();
    expect(useAppStore.getState().registrationEventId).toBeNull();

    // Issued batch preserves registrationEventId if clearCsvData runs
    useAppStore.setState({ registrationEventId: 'evt-issued', issuanceStarted: true });
    useAppStore.getState().clearCsvData();
    expect(useAppStore.getState().registrationEventId).toBe('evt-issued');
  });

  it('records and restores boxes, qrZones, and images together across undo/redo', () => {
    useAppStore.getState().addBox({ x: 20, y: 20, w: 100, h: 40 });
    useAppStore.getState().addQrZone(300, 300, 90);
    useAppStore.getState().addImage({ x: 400, y: 80, w: 60, h: 60, src: 'data:image/png;base64,iVBORw0KGgo=' });

    const initial = useAppStore.getState();
    useHistoryStore.getState().pushState(initial.boxes, initial.qrZones, initial.images);

    // Mutate all three layers
    useAppStore.getState().setBoxes([]);
    useAppStore.getState().setQrZones([]);
    useAppStore.getState().setImages([]);

    const mutated = useAppStore.getState();
    const undone = useHistoryStore.getState().undo(mutated.boxes, mutated.qrZones, mutated.images);
    expect(undone).not.toBeNull();
    expect(undone?.boxes).toHaveLength(1);
    expect(undone?.qrZones).toHaveLength(1);
    expect(undone?.images).toHaveLength(1);

    const redone = useHistoryStore.getState().redo(undone!.boxes, undone!.qrZones, undone!.images);
    expect(redone).not.toBeNull();
    expect(redone?.boxes).toHaveLength(0);
    expect(redone?.qrZones).toHaveLength(0);
    expect(redone?.images).toHaveLength(0);
  });
});
