export function emptyContextDb() {
  return {
    transaction: <T>(operation: () => T) => operation,
    prepare(sql: string) {
      if (sql.includes("b.type='context-sources-v1'")) return { all: () => [] };
      if (sql === 'SELECT text FROM messages WHERE id=?') return { get: () => ({ text: '' }) };
      if (sql === 'SELECT project_id AS projectId FROM conversations WHERE id=?')
        return { get: () => ({ projectId: null }) };
      throw new Error(`Unexpected fixture query: ${sql}`);
    },
  };
}
