export const TEST_DB_NAME = "pn_api_test";
export const adminUrl = () => process.env.TEST_ADMIN_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
export const testDbUrl = () => {
  const u = new URL(adminUrl());
  u.pathname = `/${TEST_DB_NAME}`;
  return u.toString();
};
