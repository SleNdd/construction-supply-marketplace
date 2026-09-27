import { Pool } from 'pg';
import { hashPassword } from '../src/security';

async function main() {
  const name=process.env.ADMIN_NAME?.trim();
  const email=process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password=process.env.ADMIN_PASSWORD;
  if (!name || name.length>100 || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !password || password.length<12 || password.length>200) {
    throw new Error('Укажите ADMIN_NAME, ADMIN_EMAIL и уникальный ADMIN_PASSWORD длиной от 12 до 200 символов');
  }
  const pool=new Pool({connectionString:process.env.DATABASE_URL});
  try {
    const existing=await pool.query<{role:string}>('SELECT role FROM users WHERE email=$1',[email]);
    if (existing.rows[0]) throw new Error(`Аккаунт ${email} уже существует (роль: ${existing.rows[0].role}); повторное создание отменено`);
    await pool.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin')",[name,email,hashPassword(password)]);
    console.log(`Администратор ${email} создан`);
  } finally { await pool.end(); }
}
main().catch((error)=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
