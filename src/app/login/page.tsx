import { connection } from 'next/server';
import LoginClient from './LoginClient';

export default async function LoginPage() {
  await connection();
  return <LoginClient />;
}
