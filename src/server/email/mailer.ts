import "server-only";
import nodemailer from "nodemailer";
import { BRAND } from "@/lib/brand";
import { env } from "@/server/env";

/** Email keluar opsional: tanpa SMTP_HOST, aplikasi tetap jalan dan lupa password dilakukan lewat admin. */
export const mailEnabled = () => !!env.SMTP_HOST && !!env.SMTP_FROM;

const transport = () =>
  nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE === "true",
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    connectionTimeout: 10_000,
    socketTimeout: 15_000,
  });

export async function sendPasswordResetEmail(to: string, name: string, url: string) {
  const text = [
    `Halo ${name},`,
    "",
    `Ada permintaan mengatur ulang password akun ${BRAND.name} Anda. Buka tautan ini dalam 1 jam:`,
    url,
    "",
    "Bila bukan Anda yang meminta, abaikan email ini. Password Anda tidak berubah.",
  ].join("\n");
  await transport().sendMail({ from: env.SMTP_FROM, to, subject: `Atur ulang password ${BRAND.name}`, text });
}
