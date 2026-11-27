import { connection } from 'next/server';
import { MailBatchCallbackClient } from './MailBatchCallbackClient';

export default async function MailBatchCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; batchId?: string; eventId?: string; reason?: string }>;
}) {
  await connection();
  const params = await searchParams;
  return (
    <MailBatchCallbackClient
      status={params.status === 'authorized' ? 'authorized' : 'error'}
      batchId={params.batchId ?? ''}
      eventId={params.eventId ?? ''}
      reason={params.reason ?? ''}
    />
  );
}
