'use client';

import { useCallback, useRef } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { ensureCertificateIds } from '../../lib/cert-registration';
import { prepareIssuedDesign } from '../../lib/template-autosave';
import type { CsvRow } from '../../types';

export function useBatchRegistration() {
  // Synchronous busy flag: React state commits too late to stop a double-click
  // from firing the batch twice (which would race the server registration).
  const inFlightRef = useRef(false);
  const {
    csvData,
    eventName,
    templateFile,
    templateImage,
    boxes,
    qrZones,
    images,
    emailColumn,
    defaultFont,
    defaultFontSize,
    defaultFontColor,
    isBatchRegistered,
    registeredCertIds,
    registeredAt,
    isBatchRegistering,
    batchRegistrationError,
    registrationDirty,
    setBatchRegistered,
    setIsBatchRegistering,
    setBatchRegistrationError,
    setRegistrationDirty,
  } = useAppStore();


  const validBoxes = boxes.filter((b) => b.field && b.field.trim() !== '');
  const needsRegistration = qrZones.length > 0;
  const isReadyToRegister = Boolean(templateImage && csvData.length > 0);
  // Export is enabled once registered and in sync; if non-QR and user hasn't registered yet,
  // registration is still the recommended single action before export
  const canExport = isReadyToRegister && isBatchRegistered && !registrationDirty;

  const getRecipientName = useCallback(
    (row: CsvRow): string => {
      // 1. Dedicated "name" field in placed boxes
      const nameField = validBoxes.find(
        (b) => b.field && b.field.toLowerCase() === 'name'
      );
      if (nameField && row[nameField.field]) {
        return row[nameField.field].trim();
      }

      // 2. Any placed field containing 'name'
      const nameLikeField = validBoxes.find(
        (b) => b.field && b.field.toLowerCase().includes('name')
      );
      if (nameLikeField && row[nameLikeField.field]) {
        return row[nameLikeField.field].trim();
      }

      // 3. Fallback: first mapped text box
      const firstField = validBoxes[0];
      if (firstField && row[firstField.field]) {
        return row[firstField.field].trim();
      }

      // 4. Fallback to any column in CSV that looks like a name
      const csvNameCol = Object.keys(row).find(
        (k) =>
          k.toLowerCase() === 'name' ||
          k.toLowerCase().includes('name') ||
          k.toLowerCase().includes('student') ||
          k.toLowerCase().includes('participant') ||
          k.toLowerCase().includes('receiver')
      );
      if (csvNameCol && row[csvNameCol]) {
        return row[csvNameCol].trim();
      }

      return Object.values(row)[0]?.trim() || 'Certificate Holder';
    },
    [validBoxes]
  );

  const registerBatch = useCallback(
    async (): Promise<boolean> => {
      if (inFlightRef.current || useAppStore.getState().isBatchRegistering || useAppStore.getState().isBatchRegistered) return false;
      if (!isReadyToRegister) {
        setBatchRegistrationError('Please upload a template and import CSV recipient data.');
        return false;
      }

      inFlightRef.current = true;
      setIsBatchRegistering(true);
      setBatchRegistrationError(null);

      const currentDraft = useAppStore.getState();
      const id = currentDraft.registrationEventId ?? crypto.randomUUID();
      useAppStore.setState({ registrationEventId: id });
      try {
        const records = csvData.map((row, i) => ({ rowIndex: i + 2, row }));
        const resolvedEventName = eventName?.trim() || 'General Event';
        const label = currentDraft.eventLabel.trim();
        const design = currentDraft.issuanceStarted ? undefined : await prepareIssuedDesign({
          templateImage, templateFile, boxes, qrZones, images, defaultFont, defaultFontSize, defaultFontColor,
        });

        const ids = await ensureCertificateIds({
          records,
          existingIds: currentDraft.registeredCertIds,
          getDisplayName: getRecipientName,
          getEmail: (row) => (emailColumn ? (row[emailColumn] || '').trim() : ''),
          eventId: id,
          eventName: resolvedEventName,
          label,
          design,
          onIssued: (partialIds) => {
            if (useAppStore.getState().registrationEventId === id) {
              useAppStore.setState({ issuanceStarted: partialIds.size > 0, registeredCertIds: partialIds });
            }
          },
        });

        const current = useAppStore.getState();
        if (current.registrationEventId !== id) return false;
        if (current.templateImage !== templateImage || current.csvData !== csvData ||
            current.boxes !== boxes || current.qrZones !== qrZones || current.images !== images ||
            current.eventName !== eventName || current.emailColumn !== emailColumn ||
            current.defaultFont !== defaultFont || current.defaultFontSize !== defaultFontSize ||
            current.defaultFontColor !== defaultFontColor) {
          throw new Error('This workspace changed during issuance. Open the event from the dashboard to review it.');
        }
        setBatchRegistered(true, ids);
        setRegistrationDirty(false);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown registration error';
        console.error('[Batch Registration Error]:', err);
        if (useAppStore.getState().registrationEventId === id) setBatchRegistrationError(message);
        return false;
      } finally {
        if (useAppStore.getState().registrationEventId === id) setIsBatchRegistering(false);
        inFlightRef.current = false;
      }
    },
    [
      isReadyToRegister,
      csvData,
      qrZones,
      eventName,
      templateImage,
      templateFile,
      boxes,
      images,
      defaultFont,
      defaultFontSize,
      defaultFontColor,
      registeredCertIds,
      getRecipientName,
      emailColumn,
      setBatchRegistered,
      setRegistrationDirty,
      setIsBatchRegistering,
      setBatchRegistrationError,
    ]
  );

  return {
    isBatchRegistered,
    isBatchRegistering,
    batchRegistrationError,
    registeredAt,
    registeredCertIds,
    registrationDirty,
    needsRegistration,
    isReadyToRegister,
    canExport,
    registerBatch,
  };
}
