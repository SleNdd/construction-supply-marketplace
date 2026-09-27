import { Controller, Post, Get, Body, Req, Res } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Request, Response } from 'express';
import { Db } from '../db';
import { ApiError, CurrentUser, hashPassword, verifyPassword, tokenHash, textField } from '../security';

@Controller('api/v1/auth')
export class AuthController {
  constructor(private readonly db: Db) {}

  private async createSession(user: CurrentUser, response: Response) {
    const token = randomBytes(32).toString('base64url');
    await this.db.pool.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '14 days')", [tokenHash(token),user.id]);
    response.cookie('om_session',token,{ httpOnly:true, sameSite:'lax', secure:process.env.COOKIE_SECURE === 'true', path:'/', maxAge:14*24*60*60*1000 });
    return { user };
  }

  @Post('register') async register(@Body() body: Record<string,unknown>, @Res({passthrough:true}) response: Response) {
    const name = textField(body.name,'name',100);
    const email = textField(body.email,'email',254).toLowerCase();
    const password = body.password;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400,'invalid_input','Неверный адрес электронной почты');
    if (typeof password!=='string' || password.length < 10 || password.length>200) throw new ApiError(400,'invalid_input','Пароль должен содержать от 10 до 200 символов');
    const user = await this.db.one<CurrentUser>('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id,name,email,role',[name,email,hashPassword(password),'buyer']);
    return this.createSession(user!,response);
  }

  @Post('login') async login(@Body() body: Record<string,unknown>, @Res({passthrough:true}) response: Response) {
    const email = textField(body.email,'email',254).toLowerCase();
    const password = body.password;
    if (typeof password!=='string' || password.length>200) throw new ApiError(400,'invalid_input','Неверный пароль');
    const key = `email:${email}`;
    const attempts = await this.db.one<{attempts:number}>('SELECT attempts FROM auth_attempts WHERE key=$1 AND reset_at>now()',[key]);
    if (attempts && attempts.attempts>=10) throw new ApiError(429,'too_many_attempts','Слишком много попыток входа. Повторите через 15 минут');
    const record = await this.db.one<CurrentUser & {password_hash:string}>('SELECT id,name,email,role,password_hash FROM users WHERE email=$1',[email]);
    if (!record || !verifyPassword(password,record.password_hash)) {
      await this.db.pool.query("INSERT INTO auth_attempts(key,attempts,reset_at) VALUES($1,1,now()+interval '15 minutes') ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN auth_attempts.reset_at<now() THEN 1 ELSE auth_attempts.attempts+1 END,reset_at=CASE WHEN auth_attempts.reset_at<now() THEN now()+interval '15 minutes' ELSE auth_attempts.reset_at END",[key]);
      throw new ApiError(401,'invalid_credentials','Неверный адрес или пароль');
    }
    await this.db.pool.query('DELETE FROM auth_attempts WHERE key=$1',[key]);
    const {password_hash: _,...user} = record;
    return this.createSession(user,response);
  }

  @Get('me') async me(@Req() request: Request) {
    const user = await this.db.user(request.cookies?.om_session);
    if (!user) throw new ApiError(401,'unauthorized','Необходимо войти в аккаунт');
    return {user};
  }

  @Post('logout') async logout(@Req() request: Request,@Res({passthrough:true}) response: Response) {
    if (request.cookies?.om_session) await this.db.pool.query('DELETE FROM sessions WHERE token_hash=$1',[tokenHash(request.cookies.om_session)]);
    response.clearCookie('om_session',{path:'/'});
    return {ok:true};
  }
}
