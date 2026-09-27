import 'reflect-metadata';
import { Module, Controller, Get, Catch, ExceptionFilter, ArgumentsHost, HttpException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { Db } from './db';
import { ApiError } from './security';
import { AuthController } from './routes/auth';
import { CatalogController } from './routes/catalog';
import { ProjectsController } from './routes/projects';
import { OrdersController } from './routes/orders';
import { OperationsController } from './routes/operations';
import { GeoController } from './routes/geo';
import { AdminController } from './routes/admin';

@Controller('api/v1')
class HealthController { @Get('health') health() { return { status: 'ok' }; } }

@Catch()
class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse();
    if (error instanceof ApiError) return response.status(error.status).json({ code: error.code, message: error.message });
    if (error instanceof HttpException) return response.status(error.getStatus()).json({ code: 'bad_request', message: error.message });
    const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
    if (code === '23505') return response.status(409).json({ code: 'conflict', message: 'Запись уже существует' });
    if (code === '23503') return response.status(400).json({ code: 'invalid_reference', message: 'Связанная запись не найдена' });
    console.error(error);
    return response.status(500).json({ code: 'internal_error', message: 'Внутренняя ошибка сервера' });
  }
}

@Module({ providers: [Db], controllers: [HealthController,AuthController,CatalogController,ProjectsController,OrdersController,OperationsController,GeoController,AdminController] })
class AppModule {}

async function main() {
  const app = await NestFactory.create(AppModule, { bodyParser: true });
  app.use(cookieParser());
  const publicOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
  const allowedOrigins = publicOrigin === 'http://localhost:3000' ? [publicOrigin, 'http://127.0.0.1:3000'] : [publicOrigin];
  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.use((request: {method:string;headers:Record<string,string|undefined>}, response: {status:(code:number)=>{json:(body:unknown)=>void}}, next:()=>void) => {
    const origin=request.headers.origin;
    const fetchSite=request.headers['sec-fetch-site'];
    if (!['GET','HEAD','OPTIONS'].includes(request.method) && ((origin && !allowedOrigins.includes(origin)) || fetchSite === 'cross-site')) {
      response.status(403).json({code:'forbidden_origin',message:'Недопустимый источник запроса'});
      return;
    }
    next();
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  const document = parse(readFileSync('openapi.yaml','utf8'));
  SwaggerModule.setup('api/docs', app, document);
  await app.listen(Number(process.env.API_PORT || 4000), '0.0.0.0');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
