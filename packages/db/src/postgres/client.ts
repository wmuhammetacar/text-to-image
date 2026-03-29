import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

export interface SqlExecutor {
  query<TRow extends QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<TRow>>;
}

export class PostgresClient implements SqlExecutor {
  private readonly pool: Pool;

  public constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }

  public query<TRow extends QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<QueryResult<TRow>> {
    return this.pool.query<TRow>(text, params as unknown[]);
  }

  public async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const result = await callback(client);
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}
