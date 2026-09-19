'use client';

import { useCallback } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { useAuthStore } from '../../store/useAuthStore';
import { ensureCertificateIds } from '../../lib/cert-registration';
import { autoSaveCurrentTemplate } from '../../lib/template-autosave';
import type { CsvRow } from '../../types';

export function useBatchRegistration() {
  const {
    csvData,
    eventName,
    templateFile,
    templateImage,
    boxes,
    qrZones,
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

  const { token } = useAuthStore();

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
    async (isUpdate: boolean = false): Promise<boolean> => {
      if (!isReadyToRegister) {
        setBatchRegistrationError('Please upload a template and import CSV recipient data.');
        return false;
      }

      setIsBatchRegistering(true);
      setBatchRegistrationError(null);

      try {
        const records = csvData.map((row, i) => ({ rowIndex: i + 2, row }));
        const useQr = qrZones.length > 0;
        const resolvedEventName = eventName?.trim() || 'General Event';

        // 1. Auto-save template image and complete layout config to templates table
        const savedTemplate = await autoSaveCurrentTemplate({
          templateImage,
          templateFile,
          eventName: resolvedEventName,
          boxes,
          qrZones,
          defaultFont,
          defaultFontSize,
          defaultFontColor,
          token,
        });

        // 2. Register participant records in certificates table
        const existingIds = isUpdate ? new Map<number, string>() : registeredCertIds;

        const ids = await ensureCertificateIds({
          records,
          existingIds,
          getDisplayName: getRecipientName,
          getEmail: (row) => (emailColumn ? (row[emailColumn] || '').trim() : ''),
          templateName: templateFile?.name || savedTemplate?.name || resolvedEventName,
          eventName: resolvedEventName,
          isStatic: !useQr,
        });

        setBatchRegistered(true, ids);
        setRegistrationDirty(false);
        setIsBatchRegistering(false);
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown registration error';
        console.error('[Batch Registration Error]:', err);
        setBatchRegistrationError(message);
        setIsBatchRegistering(false);
        return false;
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
      defaultFont,
      defaultFontSize,
      defaultFontColor,
      token,
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
