import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { ApiError, CurrentUser, tokenHash } from './security';

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });

  async rows<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.pool.query<T>(sql, params)).rows;
  }

  async one<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.rows<T>(sql, params))[0] ?? null;
  }

  async user(token?: string): Promise<CurrentUser | null> {
    if (!token || token.length > 256) return null;
    return this.one<CurrentUser>('SELECT u.id,u.name,u.email,u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()', [tokenHash(token)]);
  }

  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async mustOwnProject(projectId: string, buyerId: string): Promise<void> {
    if (!await this.one('SELECT id FROM projects WHERE id=$1 AND buyer_id=$2', [projectId,buyerId])) throw new ApiError(404, 'not_found', 'Объект не найден');
  }

  async onModuleDestroy() { await this.pool.end(); }
}
