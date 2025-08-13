// Language: TypeScript (Bun)
// Imports resolve automatically in Windmill (standard mode).
import * as wmill from 'windmill-client';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import * as nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';

type MySQLRes = { host: string; port: number; user: string; password: string; database: string };
type SMTPRes  = { host: string; port: number; user?: string; password?: string };

type Body = { username: string; password: string; email: string };

/**
 * @param body               JSON body from the HTTP route (wrap body = on)
 * @param mysql_resource     Windmill resource path to MySQL (e.g. "u/me/mysql_main")
 * @param smtp_resource      Windmill resource path to SMTP  (e.g. "u/me/smtp_main")
 * @param public_base_url    Your public base URL used in the email (e.g. "https://api.example.com")
 */
export async function main(
  body: Body,
  mysql_resource: string,
  smtp_resource: string,
  public_base_url: string
) {
  if (!body?.username || !body?.password || !body?.email) {
    return { windmill_status_code: 400, result: { error: 'username, password, email required' } };
  }

  const db   = await wmill.getResource(mysql_resource) as MySQLRes;
  const smtp = await wmill.getResource(smtp_resource) as SMTPRes;

  const conn = await mysql.createConnection({
    host: db.host, port: db.port, user: db.user, password: db.password, database: db.database
  });

  try {
    // 1) Check duplicates
    const [existing] = await conn.execute(
      'SELECT id FROM user WHERE username = ? OR email = ? LIMIT 1',
      [body.username, body.email]
    );
    if ((existing as any[]).length) {
      return { windmill_status_code: 409, result: { error: 'Username or email already exists' } };
    }

    // 2) Hash password (bcrypt, stronger than raw SHA-256)
    const password_hash = await bcrypt.hash(body.password, 12);

    // 3) Create verification token + insert
    const token = randomUUID();
    await conn.execute(
      'INSERT INTO user (username, password, email, verification_token, verified) VALUES (?, ?, ?, ?, 0)',
      [body.username, password_hash, body.email, token]
    );

    // 4) Send verification email
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined
    });

    const verifyUrl = `${public_base_url}/verify-user/${token}`;
    await transporter.sendMail({
      from: smtp.user,
      to: body.email,
      subject: 'Verify Email Address',
      html: `Click on the following link to <strong>Verify</strong> your account.<br/><a href="${verifyUrl}">Verify Your Account</a>`
    });

    // Windmill sync endpoints can set status via special key (status code will be 201).:contentReference[oaicite:2]{index=2}
    return {
      windmill_status_code: 201,
      result: { message: `New User: ${body.username} created. Please check your email to verify your account.` }
    };
  } finally {
    await conn.end();
  }
}
