import { connection } from 'next/server';
import AdminClient from './AdminClient';

export default async function AdminPage() {
  await connection();
  return <AdminClient />;
}
