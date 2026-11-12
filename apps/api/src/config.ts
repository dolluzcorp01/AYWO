import { z } from 'zod';

// Every outside service starts on a dummy key. Pavithran replaces them in .env; nothing else changes.
const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.string().default('http://localhost:3000'),
  WEB_URL: z.string().default('http://localhost:8081'),

  // The header the platform's own proxy sets to the visitor's address, which a visitor cannot forge. Rate limits key on it.
  // DigitalOcean App Platform sets this one. Leave it EMPTY when nothing in front of the API overwrites it (a bare
  // Droplet), or anyone could send their own value and escape every limit.
  CLIENT_IP_HEADER: z.string().default('do-connecting-ip'),

  DATABASE_URL: z.string(),
  DATABASE_SSL: z.string().default('false'),
  // The database's CA certificate (PEM text). DigitalOcean: Databases > your cluster > Download CA certificate.
  // With it the API checks it is really talking to our database, not just that the line is encrypted.
  DATABASE_CA_CERT: z.string().default(''),

  JWT_SECRET: z.string().min(32),
  OTP_SECRET: z.string().min(16),
  // A fixed login for Apple and Google app reviewers. In production it also needs OTP_TEST_UNTIL, the moment it stops
  // working, so a review that ended cannot leave a known code open. After that the number is treated like any other.
  OTP_TEST_PHONE: z.string().default(''),
  OTP_TEST_CODE: z.string().default(''),
  OTP_TEST_UNTIL: z.string().default(''),

  SMS_PROVIDER: z.enum(['console', 'msg91', 'twilio']).default('console'),
  MSG91_AUTH_KEY: z.string().default('dummy'),
  MSG91_TEMPLATE_ID: z.string().default('dummy'),
  TWILIO_ACCOUNT_SID: z.string().default('dummy'),
  TWILIO_AUTH_TOKEN: z.string().default('dummy'),
  TWILIO_FROM: z.string().default('dummy'),

  SENDGRID_API_KEY: z.string().default('SG.dummy'),
  EMAIL_FROM: z.string().default('hello@aywo.in'),
  EMAIL_FROM_NAME: z.string().default('AYWO'),

  SPACES_ENDPOINT: z.string().default('https://blr1.digitaloceanspaces.com'),
  SPACES_REGION: z.string().default('blr1'),
  SPACES_BUCKET: z.string().default('aywo'),
  SPACES_KEY: z.string().default('dummy'),
  SPACES_SECRET: z.string().default('dummy'),
  // 'true' for the local file store on a laptop (http://localhost:9000/aywo/file). DigitalOcean Spaces uses the default.
  SPACES_PATH_STYLE: z.string().default('false'),

  RAZORPAY_KEY_ID: z.string().default('rzp_test_dummy'),
  RAZORPAY_KEY_SECRET: z.string().default('dummy'),
  RAZORPAY_WEBHOOK_SECRET: z.string().default('dummy'),
  RAZORPAY_PLAN_MONTHLY: z.string().default('plan_dummy_monthly'),
  RAZORPAY_PLAN_YEARLY: z.string().default('plan_dummy_yearly'),

  STRIPE_SECRET_KEY: z.string().default('sk_test_dummy'),
  STRIPE_WEBHOOK_SECRET: z.string().default('whsec_dummy'),
  STRIPE_PRICE_MONTHLY: z.string().default('price_dummy_monthly'),
  STRIPE_PRICE_YEARLY: z.string().default('price_dummy_yearly'),

  REVENUECAT_WEBHOOK_AUTH: z.string().default('dummy'),

  // Staff second sign-in step (authenticator app). Production always requires it unless set to 'off' for an emergency.
  // Elsewhere it is optional unless set to 'required'.
  STAFF_TWO_STEP: z.enum(['', 'required', 'off']).default(''),
  // Seals staff authenticator secrets in the database. Optional: without it a key is made from JWT_SECRET.
  // A separate random value is better, so a leaked JWT_SECRET does not also open these.
  STAFF_SECRET_KEY: z.string().default(''),
  // Nightly database backup, encrypted with this key (32 random bytes, base64: openssl rand -base64 32).
  // Keep a copy somewhere safe outside DigitalOcean: without it a backup cannot be opened. Empty turns backups off.
  BACKUP_KEY: z.string().default(''),
  // Where backups go. A separate bucket from people's photos. Empty means "<SPACES_BUCKET>-backups".
  SPACES_BACKUP_BUCKET: z.string().default(''),
  // Who gets an email when something breaks (a job keeps failing, a backup fails, errors spike). Empty: logs only.
  OPS_ALERT_EMAIL: z.string().default(''),
});

export const config = schema.parse(process.env);
export const isProduction = config.NODE_ENV === 'production';

if (isProduction && config.STAFF_SECRET_KEY && config.STAFF_SECRET_KEY.length < 32) {
  throw new Error('STAFF_SECRET_KEY must be at least 32 random characters');
}

// .env.example's values are public: anyone could sign a token for any account with them.
if (isProduction && (/dummy/i.test(config.JWT_SECRET) || /dummy/i.test(config.OTP_SECRET))) {
  throw new Error('JWT_SECRET and OTP_SECRET must be real random values in production');
}

/** The backup key as 32 bytes, or null when backups are off. A key of the wrong size refuses to start the server. */
export function backupKey(): Buffer | null {
  if (!config.BACKUP_KEY) return null;
  const key = Buffer.from(config.BACKUP_KEY, 'base64');
  if (key.length !== 32) throw new Error('BACKUP_KEY must be 32 random bytes in base64 (openssl rand -base64 32)');
  return key;
}
backupKey();

export const backupBucket = config.SPACES_BACKUP_BUCKET || `${config.SPACES_BUCKET}-backups`;

/** Six digits, and not one a person would try first. */
function strongTestCode(code: string): boolean {
  return /^\d{6}$/.test(code) && !/^(\d)\1{5}$/.test(code) && !'0123456789'.includes(code) && !'9876543210'.includes(code);
}

// The laptop file store's public password, or a file store on this machine, must never hold real families' photos.
if (isProduction && (config.SPACES_KEY === 'minioadmin' || /localhost|127\.0\.0\.1/.test(config.SPACES_ENDPOINT))) {
  throw new Error('SPACES_ENDPOINT and SPACES_KEY must point at the real file store in production');
}

// Encryption without a checked certificate lets anyone in the middle pretend to be the database.
if (isProduction && config.DATABASE_SSL === 'true' && !config.DATABASE_CA_CERT.includes('BEGIN CERTIFICATE')) {
  throw new Error('DATABASE_CA_CERT must hold the database CA certificate in production');
}

if (isProduction && config.OTP_TEST_PHONE && !strongTestCode(config.OTP_TEST_CODE)) {
  throw new Error('OTP_TEST_CODE is too easy to guess for production');
}

/** Is this number the reviewers' fixed login, right now? Production needs an end date that has not passed. */
export function isReviewerLogin(phone: string | null | undefined): boolean {
  if (!config.OTP_TEST_PHONE || phone !== config.OTP_TEST_PHONE || !/^\d{6}$/.test(config.OTP_TEST_CODE)) return false;
  if (!isProduction) return true;
  const until = Date.parse(config.OTP_TEST_UNTIL);
  return Number.isFinite(until) && Date.now() < until;
}
