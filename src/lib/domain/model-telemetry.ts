export type TelemetrySource = 'websocket' | 'manual' | 'demo' | 'unknown';

export type Vector3 = Readonly<{
	x: number;
	y: number;
	z: number;
}>;

export type Dimensions3D = Readonly<{
	width: number;
	height: number;
	depth: number;
}>;

export type TelemetryAnchor = 'center' | 'base';

export type Bounds3D = Readonly<{
	min: Vector3;
	max: Vector3;
}>;

export type TelemetryIssue = Readonly<{
	field: string;
	message: string;
	severity: 'warning' | 'error';
}>;

export type RawModelTelemetry = Readonly<Record<string, unknown>>;

export type ModelTelemetry = Readonly<{
	id: string;
	name: string;
	position: Vector3;
	dimensions: Dimensions3D;
	volume: number;
	anchor: TelemetryAnchor;
	bounds: Bounds3D;
	rotationY?: number;
	partOf?: string;
	component?: string;
	receivedAt: string;
	source: TelemetrySource;
}>;

export type TelemetryParseSuccess = Readonly<{
	ok: true;
	value: ModelTelemetry;
	warnings: TelemetryIssue[];
}>;

export type TelemetryParseFailure = Readonly<{
	ok: false;
	issues: TelemetryIssue[];
}>;

export type TelemetryParseResult = TelemetryParseSuccess | TelemetryParseFailure;

const DEFAULT_POSITION: Vector3 = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_DIMENSIONS: Dimensions3D = Object.freeze({ width: 1, height: 1, depth: 1 });

function isRecord(value: unknown): value is RawModelTelemetry {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string | null {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
	}

	if (typeof value === 'number' && Number.isFinite(value)) {
		return String(value);
	}

	return null;
}

function toNumber(value: unknown): number | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === 'string') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}

	return null;
}

function parseVector3(
	candidate: unknown,
	fieldPrefix: string
): { value: Vector3; issue?: TelemetryIssue } {
	if (!isRecord(candidate)) {
		return {
			value: DEFAULT_POSITION,
			issue: {
				field: fieldPrefix,
				message: 'No se encontró la ubicación; se usó 0,0,0 como valor por defecto.',
				severity: 'warning'
			}
		};
	}

	const x = toNumber(candidate.x) ?? toNumber(candidate.left) ?? 0;
	const y = toNumber(candidate.y) ?? toNumber(candidate.up) ?? 0;
	const z = toNumber(candidate.z) ?? toNumber(candidate.forward) ?? 0;

	return { value: { x, y, z } };
}

function parseDimensions(candidate: unknown): { value: Dimensions3D; issue?: TelemetryIssue } {
	if (typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0) {
		const side = Math.cbrt(candidate);

		return {
			value: {
				width: side,
				height: side,
				depth: side
			}
		};
	}

	if (!isRecord(candidate)) {
		return {
			value: DEFAULT_DIMENSIONS,
			issue: {
				field: 'dimensions',
				message: 'No se encontraron dimensiones; se usó 1x1x1 como valor por defecto.',
				severity: 'warning'
			}
		};
	}

	const width = toNumber(candidate.width) ?? toNumber(candidate.x) ?? 1;
	const height = toNumber(candidate.height) ?? toNumber(candidate.y) ?? 1;
	const depth = toNumber(candidate.depth) ?? toNumber(candidate.z) ?? 1;

	return { value: { width, height, depth } };
}

function computeVolume(dimensions: Dimensions3D): number {
	return dimensions.width * dimensions.height * dimensions.depth;
}

function computeBounds(
	position: Vector3,
	dimensions: Dimensions3D,
	anchor: TelemetryAnchor,
	rotationY = 0
): Bounds3D {
	const quarterTurns = Math.round(rotationY / (Math.PI / 2));
	const rotate90 = Math.abs(quarterTurns % 2) === 1;
	const width = rotate90 ? dimensions.depth : dimensions.width;
	const depth = rotate90 ? dimensions.width : dimensions.depth;

	if (anchor === 'base') {
		return {
			min: {
				x: position.x - width / 2,
				y: position.y,
				z: position.z - depth / 2
			},
			max: {
				x: position.x + width / 2,
				y: position.y + dimensions.height,
				z: position.z + depth / 2
			}
		};
	}

	return {
		min: {
			x: position.x - width / 2,
			y: position.y - dimensions.height / 2,
			z: position.z - depth / 2
		},
		max: {
			x: position.x + width / 2,
			y: position.y + dimensions.height / 2,
			z: position.z + depth / 2
		}
	};
}

function parseTelemetryAnchor(value: unknown): TelemetryAnchor {
	return value === 'base' ? 'base' : 'center';
}

function parseTelemetryRotation(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function normalizeModelKey(value: string): string {
	return value.trim().toLowerCase();
}

function parseTimestamp(value: unknown): string {
	if (typeof value === 'string' && value.trim().length > 0) {
		const normalized = new Date(value);
		if (!Number.isNaN(normalized.getTime())) {
			return normalized.toISOString();
		}
	}

	return new Date().toISOString();
}

function parseModelName(payload: RawModelTelemetry): string | null {
	return toText(payload.modelName) ?? toText(payload.name) ?? toText(payload.label);
}

function parseModelId(payload: RawModelTelemetry, name: string): string {
	return toText(payload.id) ?? toText(payload.modelId) ?? normalizeModelKey(name);
}

function parseModelRelation(value: unknown): string | undefined {
	return toText(value) ?? undefined;
}

export function parseModelTelemetry(
	input: unknown,
	source: TelemetrySource = 'unknown'
): TelemetryParseResult {
	let payload: unknown = input;

	if (typeof input === 'string') {
		try {
			payload = JSON.parse(input);
		} catch {
			return {
				ok: false,
				issues: [
					{
						field: 'root',
						message: 'El mensaje no es JSON válido.',
						severity: 'error'
					}
				]
			};
		}
	}

	if (!isRecord(payload)) {
		return {
			ok: false,
			issues: [
				{
					field: 'root',
					message: 'La telemetría debe ser un objeto JSON.',
					severity: 'error'
				}
			]
		};
	}

	const warnings: TelemetryIssue[] = [];
	const name = parseModelName(payload);

	if (!name) {
		return {
			ok: false,
			issues: [
				{
					field: 'name',
					message: 'La telemetría debe incluir modelName o name.',
					severity: 'error'
				}
			]
		};
	}

	const positionCandidate = payload.position ?? payload.location;
	const positionResult = parseVector3(positionCandidate, 'position');
	if (positionResult.issue) {
		warnings.push(positionResult.issue);
	}

	const dimensionsCandidate = payload.dimensions ?? payload.volume;
	const dimensionsResult = parseDimensions(dimensionsCandidate);
	if (dimensionsResult.issue) {
		warnings.push(dimensionsResult.issue);
	}

	const anchor = parseTelemetryAnchor(payload.anchor);
	const rotationY = parseTelemetryRotation(payload.rotationY);
	const partOf = parseModelRelation(payload.partOf);
	const component = parseModelRelation(payload.component);
	const receivedAt = parseTimestamp(payload.timestamp ?? payload.receivedAt);
	const bounds = computeBounds(positionResult.value, dimensionsResult.value, anchor, rotationY);

	return {
		ok: true,
		warnings,
		value: {
			id: parseModelId(payload, name),
			name,
			position: positionResult.value,
			dimensions: dimensionsResult.value,
			volume: computeVolume(dimensionsResult.value),
			anchor,
			bounds,
			rotationY,
			partOf,
			component,
			receivedAt,
			source
		}
	};
}

export function formatNumber(value: number, fractionDigits = 2): string {
	return new Intl.NumberFormat('es-ES', {
		maximumFractionDigits: fractionDigits,
		minimumFractionDigits: fractionDigits
	}).format(value);
}

export function formatVector3(value: Vector3): string {
	return `x=${formatNumber(value.x)} · y=${formatNumber(value.y)} · z=${formatNumber(value.z)}`;
}

export function formatDimensions3D(value: Dimensions3D): string {
	return `${formatNumber(value.width)} × ${formatNumber(value.height)} × ${formatNumber(value.depth)}`;
}

export function formatBounds3D(value: Bounds3D): string {
	return `x=${formatNumber(value.min.x)}..${formatNumber(value.max.x)} · y=${formatNumber(value.min.y)}..${formatNumber(value.max.y)} · z=${formatNumber(value.min.z)}..${formatNumber(value.max.z)}`;
}

export function formatTelemetrySummary(value: ModelTelemetry): string {
	const relation = [
		value.component ? `component=${value.component}` : null,
		value.partOf ? `partOf=${value.partOf}` : null
	]
		.filter((item): item is string => item !== null)
		.join(' · ');
	const relationLabel = relation ? ` | ${relation}` : '';
	const rotationLabel = typeof value.rotationY === 'number' ? ` | rot=${formatNumber((value.rotationY * 180) / Math.PI, 0)}°` : '';

	return `${value.name} | ${formatVector3(value.position)} | anchor=${value.anchor}${rotationLabel}${relationLabel} | volumen=${formatDimensions3D(value.dimensions)} | cubicUnits=${formatNumber(value.volume)} | bounds=${formatBounds3D(value.bounds)}`;
}

export function formatTimestamp(value: string): string {
	const date = new Date(value);

	if (Number.isNaN(date.getTime())) {
		return value;
	}

	return new Intl.DateTimeFormat('es-ES', {
		dateStyle: 'medium',
		timeStyle: 'medium'
	}).format(date);
}

export function createDemoTelemetry(
	name: string,
	position: Vector3,
	dimensions: Dimensions3D,
	receivedAt: string,
	source: TelemetrySource = 'demo',
	anchor: TelemetryAnchor = 'center',
	rotationY?: number,
	partOf?: string,
	component?: string
): ModelTelemetry {
	return {
		id: normalizeModelKey(name),
		name,
		position,
		dimensions,
		volume: computeVolume(dimensions),
		anchor,
		bounds: computeBounds(position, dimensions, anchor, rotationY),
		rotationY,
		partOf,
		component,
		receivedAt,
		source
	};
}

export function cloneTelemetry(value: ModelTelemetry): ModelTelemetry {
	return {
		...value,
		position: { ...value.position },
		dimensions: { ...value.dimensions },
		bounds: {
			min: { ...value.bounds.min },
			max: { ...value.bounds.max }
		},
		rotationY: value.rotationY,
		partOf: value.partOf,
		component: value.component
	};
}

export { DEFAULT_DIMENSIONS, DEFAULT_POSITION };
