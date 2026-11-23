process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/morse_test';
process.env.RATE_LIMIT_DISABLED = '1';
process.env.APP_URL = 'http://localhost:3000';
process.env.STUDY_CONTACT_NAME = 'Test Researcher';
process.env.STUDY_CONTACT_EMAIL = 'researcher@example.org';
