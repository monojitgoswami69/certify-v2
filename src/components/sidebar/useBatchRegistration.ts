'use client';

import { useAppStore } from '../../store/useAppStore';
import { ensureCertificateIds } from '../../lib/cert-registration';
import { prepareIssuedDesign } from '../../lib/template-autosave';
import { selectRecipientName } from '../../lib/batch-review';

export function useBatchRegistration() {
  const { templateImage, csvData, isBatchRegistered, isBatchRegistering, batchRegistrationError,
    registeredCertIds, registeredAt, registrationDirty, qrZones } = useAppStore();
  const isReadyToRegister = Boolean(templateImage && csvData.length > 0);
  return {
    isBatchRegistered, isBatchRegistering, batchRegistrationError, registeredCertIds, registeredAt, registrationDirty,
    needsRegistration: qrZones.length > 0, isReadyToRegister,
    canExport: isReadyToRegister && isBatchRegistered && !registrationDirty,
  };
}

export async function registerReviewedBatch(reviewed: ReturnType<typeof useAppStore.getState>, selected: Set<number>) {
  const draft = useAppStore.getState();
  const { templateImage, templateFile, boxes, qrZones, images, defaultFont, defaultFontSize, defaultFontColor } = draft;
  if (draft.isBatchRegistering || draft.isBatchRegistered || !templateImage
    || draft.csvData !== reviewed.csvData || draft.csvReview !== reviewed.csvReview
    || templateImage !== reviewed.templateImage || boxes !== reviewed.boxes || images !== reviewed.images || qrZones !== reviewed.qrZones
    || draft.emailColumn !== reviewed.emailColumn || draft.eventName !== reviewed.eventName || draft.eventLabel !== reviewed.eventLabel) {
    throw new Error('The roster or design changed. Close the review and open it again.');
  }

  const records = draft.csvData.map((row, index) => ({ rowIndex: draft.csvReview.numbers[index], row }))
    .filter(({ rowIndex }) => selected.has(rowIndex) || draft.registeredCertIds.has(rowIndex));
  const id = draft.registrationEventId ?? crypto.randomUUID();
  const applyRoster = () => {
    if (records.length !== draft.csvData.length) {
      useAppStore.setState({
        csvData: records.map(({ row }) => row),
        csvReview: { ...draft.csvReview, numbers: records.map(({ rowIndex }) => rowIndex) },
      });
    }
  };

  useAppStore.setState({ registrationEventId: id, isBatchRegistering: true, batchRegistrationError: null });
  try {
    const design = draft.issuanceStarted ? undefined : await prepareIssuedDesign({
      templateImage, templateFile, boxes, qrZones, images, defaultFont, defaultFontSize, defaultFontColor,
    }, { includePreview: true });
    const ids = await ensureCertificateIds({
      records, existingIds: draft.registeredCertIds,
      getDisplayName: (row) => selectRecipientName(row, boxes),
      getEmail: (row) => (row[draft.emailColumn] ?? '').trim(),
      eventId: id, eventName: draft.eventName.trim() || 'General Event', label: draft.eventLabel.trim(),
      design, mailPreferences: draft.emailSettings,
      onIssued: (partialIds, verificationOrigin) => {
        if (useAppStore.getState().registrationEventId === id) {
          useAppStore.setState({ issuanceStarted: partialIds.size > 0, registeredCertIds: partialIds, verificationOrigin });
        }
      },
    });
    const current = useAppStore.getState();
    if (current.registrationEventId !== id || current.csvData !== draft.csvData || current.templateImage !== templateImage) {
      throw new Error('The workspace changed during issuance. Open the event from the dashboard to review it.');
    }
    applyRoster();
    current.setBatchRegistered(true, ids);
    current.setRegistrationDirty(false);
  } catch (error) {
    const current = useAppStore.getState();
    if (current.registrationEventId === id) {
      if (current.issuanceStarted && current.csvData === draft.csvData) applyRoster();
      draft.setBatchRegistrationError(error instanceof Error ? error.message : 'Could not issue certificates.');
    }
    throw error;
  } finally {
    if (useAppStore.getState().registrationEventId === id) draft.setIsBatchRegistering(false);
  }
}
