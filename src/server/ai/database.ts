/** MySQL 死锁回滚后有限重试，配额与会话状态仍由事务里的条件更新决定。 */
export async function retryAiTransaction<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt >= 2 || !error || typeof error !== "object" || !("code" in error) || error.code !== "P2034") throw error;
      await new Promise(resolve => setTimeout(resolve, 15 * (attempt + 1)));
    }
  }
}
