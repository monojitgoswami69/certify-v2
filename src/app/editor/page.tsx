import { connection } from 'next/server';
import EditorClient from './EditorClient';

export default async function CertificateStudioPage() {
  await connection();
  return <EditorClient />;
}
