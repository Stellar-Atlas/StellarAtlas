import { revalidatePath, revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

interface RevalidatePayload {
	readonly paths?: unknown;
	readonly tags?: unknown;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
	if (!isAuthorized(request)) {
		return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
	}

	const payload = (await request.json().catch(() => null)) as
		| RevalidatePayload
		| null;
	if (payload === null) {
		return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const tags = collectValidTags(payload.tags);
	const paths = collectValidPaths(payload.paths);
	if (tags.length === 0 && paths.length === 0) {
		return NextResponse.json(
			{ error: 'Provide at least one valid tag or path' },
			{ status: 400 }
		);
	}

	tags.forEach((tag) => revalidateTag(tag, { expire: 0 }));
	paths.forEach((path) => revalidatePath(path));

	return NextResponse.json({
		paths,
		revalidated: true,
		tags
	});
}

const isAuthorized = (request: NextRequest): boolean => {
	const token = process.env.STELLAR_ATLAS_REVALIDATE_TOKEN?.trim();
	if (!token) return false;

	const authorization = request.headers.get('authorization');
	const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
	const headerToken = request.headers.get('x-revalidate-token')?.trim();

	return bearerToken === token || headerToken === token;
};

const collectValidTags = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];

	return Array.from(
		new Set(
			value.filter(
				(tag): tag is string =>
					typeof tag === 'string' &&
					tag.length > 0 &&
					tag.length <= 256
			)
		)
	);
};

const collectValidPaths = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];

	return Array.from(
		new Set(
			value.filter(
				(path): path is string =>
					typeof path === 'string' &&
					path.startsWith('/') &&
					path.length > 0 &&
					path.length <= 1024
			)
		)
	);
};
