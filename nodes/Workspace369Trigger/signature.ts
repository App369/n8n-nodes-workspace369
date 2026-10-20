import { createHmac, timingSafeEqual } from 'crypto';

/** A delivery whose timestamp is further than this from now (either direction) is rejected. */
export const REPLAY_WINDOW_MS = 5 * 60 * 1000;

/** True when the epoch-ms timestamp is a number within the replay window of `now`. */
export function isTimestampFresh(timestamp: string | undefined, now: number = Date.now()): boolean {
	if (!timestamp || !/^\d+$/.test(timestamp.trim())) return false;
	const ms = Number(timestamp);
	if (!Number.isFinite(ms)) return false;
	return Math.abs(now - ms) <= REPLAY_WINDOW_MS;
}

/** Hex HMAC-SHA256 over (raw body + timestamp), keyed with the full whsec_ secret. */
export function computeSignature(secret: string, rawBody: string, timestamp: string): string {
	return createHmac('sha256', secret)
		.update(rawBody + timestamp, 'utf8')
		.digest('hex');
}

export function verifySignature(
	secret: string,
	rawBody: string,
	timestamp: string | undefined,
	signature: string | undefined,
): boolean {
	if (!timestamp || !signature) return false;
	const expected = Buffer.from(computeSignature(secret, rawBody, timestamp), 'utf8');
	const received = Buffer.from(signature.trim(), 'utf8');
	if (expected.length !== received.length) return false;
	return timingSafeEqual(expected, received);
}
