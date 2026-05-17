import {
	createDemoTelemetry,
	type Dimensions3D,
	type ModelTelemetry,
	type Vector3
} from './model-telemetry';

export type ScenePhase =
	| 'idle'
	| 'approach-pallet'
	| 'insert-forks'
	| 'lift-pallet'
	| 'travel-to-rack'
	| 'place-pallet'
	| 'return-to-pallet'
	| 'complete';

export type SceneObjectKind = 'forklift' | 'pallet' | 'boxes' | 'rack';

export type LoadPackageState = Readonly<{
	id: string;
	pallet: SceneObjectState;
	boxes: SceneObjectState;
	shelfIndex?: number;
}>;

export type SceneObjectState = Readonly<{
	kind: SceneObjectKind;
	name: string;
	position: Vector3;
	dimensions: Dimensions3D;
}>;

export type ForkliftKinematics = Readonly<{
	position: Vector3;
	rotationY: number;
	forkHeight: number;
}>;

export type DeliveredLoadState = Readonly<{
	id: string;
	pallet: SceneObjectState;
	boxes: SceneObjectState;
	shelfIndex: number;
}>;

export type ForkliftSimulationSnapshot = Readonly<{
	phase: ScenePhase;
	message: string;
	forklift: ForkliftKinematics;
	pallet: SceneObjectState;
	boxes: SceneObjectState;
	rack: SceneObjectState;
	loads: LoadPackageState[];
	deliveredLoads: DeliveredLoadState[];
	activeLoadIndex: number;
	totalLoads: number;
	autoPilot: boolean;
	carryingPallet: boolean;
	completed: boolean;
	telemetry: ModelTelemetry[];
}>;

export type ForkliftSimulationConfig = Readonly<{
	forkliftSpeed: number;
	forkliftTurnSpeedDeg: number;
	forkHeightSpeed: number;
	forkLiftHeight: number;
	forkDownHeight: number;
	pickupDistance: number;
	placeDistance: number;
}>;

const DEFAULT_CONFIG: ForkliftSimulationConfig = Object.freeze({
	forkliftSpeed: 0.72,
	forkliftTurnSpeedDeg: 55,
	forkHeightSpeed: 0.35,
	forkLiftHeight: 0.72,
	forkDownHeight: 0.17,
	pickupDistance: 0.55,
	placeDistance: 0.7
});

const DEFAULT_DIMENSIONS = Object.freeze({
	forklift: Object.freeze({ width: 2.6, height: 1.8, depth: 1.6 }),
	pallet: Object.freeze({ width: 1.25, height: 0.14, depth: 1.0 }),
	boxes: Object.freeze({ width: 0.88, height: 0.42, depth: 0.34 }),
	rack: Object.freeze({ width: 5.4, height: 4.8, depth: 1.5 })
});

const CARGO_CLEARANCE_X = 0.05;
const CARGO_CARRY_OFFSET_X =
	DEFAULT_DIMENSIONS.forklift.width / 2 + DEFAULT_DIMENSIONS.pallet.width / 2 + CARGO_CLEARANCE_X;
const FORK_TOP_OFFSET_Y = 0.1;
const RACK_ROTATION_Y = Math.PI / 2;
const RACK_SHELF_LEVELS = [
	{ beamY: 0.7, cargoY: 0.78, component: 'shelf-1' },
	{ beamY: 1.58, cargoY: 1.66, component: 'shelf-2' },
	{ beamY: 2.46, cargoY: 2.54, component: 'shelf-3' },
	{ beamY: 3.34, cargoY: 3.42, component: 'shelf-4' }
] as const;

const FLOOR_Y = 0;
const PALLET_Y = FLOOR_Y + 0.07;
const PALLET_THICKNESS = 0.14;
const LOAD_SOURCE_POSITIONS = [
	{ x: -1.4, y: PALLET_Y, z: 0 },
	{ x: -1.4, y: PALLET_Y, z: 1.15 },
	{ x: -1.4, y: PALLET_Y, z: 2.3 }
] as const;
const LOAD_RACK_SLOT_OFFSETS = [-1.15, 0, 1.15] as const;
const RACK_Y = FLOOR_Y;
const INITIAL_FORKLIFT_POSITION: Vector3 = Object.freeze({ x: -7.8, y: 0, z: 0 });
const INITIAL_PALLET_POSITION: Vector3 = Object.freeze({ ...LOAD_SOURCE_POSITIONS[0] });
const INITIAL_RACK_POSITION: Vector3 = Object.freeze({ x: 4.2, y: RACK_Y, z: 0 });
const TOTAL_LOADS = LOAD_SOURCE_POSITIONS.length;

function cloneVector3(value: Vector3): Vector3 {
	return { x: value.x, y: value.y, z: value.z };
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

function degreesToRadians(value: number): number {
	return (value * Math.PI) / 180;
}

function forwardVector(rotationY: number): Vector3 {
	return {
		x: Math.cos(rotationY),
		y: 0,
		z: Math.sin(rotationY)
	};
}

function addVector(base: Vector3, delta: Vector3): Vector3 {
	return {
		x: base.x + delta.x,
		y: base.y + delta.y,
		z: base.z + delta.z
	};
}

function scaleVector(value: Vector3, scalar: number): Vector3 {
	return {
		x: value.x * scalar,
		y: value.y * scalar,
		z: value.z * scalar
	};
}

function distance2D(left: Vector3, right: Vector3): number {
	return Math.hypot(left.x - right.x, left.z - right.z);
}

function objectState(
	kind: SceneObjectKind,
	name: string,
	position: Vector3,
	dimensions: Dimensions3D
): SceneObjectState {
	return {
		kind,
		name,
		position,
		dimensions
	};
}

function formatFacing(rotationY: number): string {
	const normalized = ((rotationY % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
	const degrees = (normalized * 180) / Math.PI;
	return `${degrees.toFixed(1)}°`;
}

function normalizeAngle(value: number): number {
	return ((value + Math.PI) % (Math.PI * 2)) - Math.PI;
}

function rotateTowards(current: number, target: number, maxDelta: number): number {
	const delta = normalizeAngle(target - current);
	const limited = clamp(delta, -maxDelta, maxDelta);
	return current + limited;
}

export class ForkliftSimulation {
	private readonly config: ForkliftSimulationConfig;
	private phase: ScenePhase = 'approach-pallet';
	private message = 'El montacargas está buscando la caja.';
	private forkliftPosition: Vector3 = cloneVector3(INITIAL_FORKLIFT_POSITION);
	private forkliftRotationY = 0;
	private forkHeight = 0.18;
	private palletPosition: Vector3 = cloneVector3(INITIAL_PALLET_POSITION);
	private boxesPosition: Vector3 = {
		x: INITIAL_PALLET_POSITION.x,
		y: INITIAL_PALLET_POSITION.y + PALLET_THICKNESS,
		z: INITIAL_PALLET_POSITION.z
	};
	private rackPosition: Vector3 = cloneVector3(INITIAL_RACK_POSITION);
	private deliveredLoads: DeliveredLoadState[] = [];
	private activeLoadIndex = 0;
	private carryingPallet = false;
	private autoPilot = true;
	private completed = false;

	constructor(config: Partial<ForkliftSimulationConfig> = {}) {
		this.config = {
			...DEFAULT_CONFIG,
			...config
		};
		this.syncCargoPositions();
	}

	reset(): void {
		this.phase = 'approach-pallet';
		this.message = 'El montacargas está buscando la caja 1 de 3.';
		this.forkliftPosition = cloneVector3(INITIAL_FORKLIFT_POSITION);
		this.forkliftRotationY = 0;
		this.forkHeight = 0.18;
		this.palletPosition = this.buildSourceLoadPosition(0);
		this.boxesPosition = {
			x: this.palletPosition.x,
			y: this.palletPosition.y + PALLET_THICKNESS,
			z: this.palletPosition.z
		};
		this.deliveredLoads = [];
		this.activeLoadIndex = 0;
		this.carryingPallet = false;
		this.completed = false;
		this.autoPilot = true;
		this.syncCargoPositions();
	}

	stopAutoPilot(): void {
		this.autoPilot = false;
	}

	startAutoPilot(): void {
		this.autoPilot = true;
	}

	moveForward(distance = 0.45): void {
		this.autoPilot = false;
		this.translate(distance);
		this.message = 'Movimiento manual hacia adelante.';
	}

	moveBackward(distance = 0.45): void {
		this.autoPilot = false;
		this.translate(-distance);
		this.message = 'Movimiento manual hacia atrás.';
	}

	turnLeft(): void {
		this.autoPilot = false;
		this.forkliftRotationY -= degreesToRadians(this.config.forkliftTurnSpeedDeg * 0.12);
		this.message = 'Giro manual hacia la izquierda.';
	}

	turnRight(): void {
		this.autoPilot = false;
		this.forkliftRotationY += degreesToRadians(this.config.forkliftTurnSpeedDeg * 0.12);
		this.message = 'Giro manual hacia la derecha.';
	}

	raiseForks(step = 0.12): void {
		this.autoPilot = false;
		this.forkHeight = clamp(
			this.forkHeight + step,
			this.config.forkDownHeight,
			this.config.forkLiftHeight
		);
		this.syncCargoPositions();
		this.message = 'Las paletas subieron.';
	}

	lowerForks(step = 0.12): void {
		this.autoPilot = false;
		this.forkHeight = clamp(
			this.forkHeight - step,
			this.config.forkDownHeight,
			this.config.forkLiftHeight
		);
		this.syncCargoPositions();
		this.message = 'Las paletas bajaron.';
	}

	update(dt: number): boolean {
		if (!this.autoPilot || this.completed) {
			this.syncCargoPositions();
			return false;
		}

		let changed = false;

		switch (this.phase) {
			case 'approach-pallet': {
				changed = this.driveToward(this.palletPickTarget(), dt, this.config.forkliftSpeed);
				if (
					distance2D(this.forkliftPosition, this.palletPickTarget()) <= this.config.pickupDistance
				) {
					this.phase = 'insert-forks';
					this.message = 'Alineando las paletas debajo de la caja.';
					changed = true;
				}
				break;
			}
			case 'insert-forks': {
				changed = this.adjustForkHeight(this.config.forkDownHeight, dt) || changed;
				if (Math.abs(this.forkHeight - this.config.forkDownHeight) <= 0.01) {
					this.attachPallet();
					this.phase = 'lift-pallet';
					this.message = 'Levantando la caja.';
					changed = true;
				}
				break;
			}
			case 'lift-pallet': {
				changed = this.adjustForkHeight(this.config.forkLiftHeight, dt) || changed;
				if (Math.abs(this.forkHeight - this.config.forkLiftHeight) <= 0.01) {
					this.phase = 'travel-to-rack';
					this.message = 'Transportando la caja hacia el rack.';
					changed = true;
				}
				break;
			}
			case 'travel-to-rack': {
				changed =
					this.driveToward(this.rackApproachTarget(), dt, this.config.forkliftSpeed) || changed;
				if (
					distance2D(this.forkliftPosition, this.rackApproachTarget()) <= this.config.placeDistance
				) {
					this.phase = 'place-pallet';
					this.message = 'Bajando la caja para colocarla en el rack.';
					changed = true;
				}
				break;
			}
			case 'place-pallet': {
				changed = this.adjustForkHeight(this.config.forkDownHeight, dt) || changed;
				if (Math.abs(this.forkHeight - this.config.forkDownHeight) <= 0.01) {
					this.detachPallet();
					changed = true;
				}
				break;
			}
			case 'return-to-pallet': {
				changed =
					this.driveToward(this.palletPickTarget(), dt, this.config.forkliftSpeed) || changed;
				if (
					distance2D(this.forkliftPosition, this.palletPickTarget()) <= this.config.pickupDistance
				) {
					this.phase = 'approach-pallet';
					this.message = `Listo para tomar la caja ${this.activeLoadIndex + 1} de ${TOTAL_LOADS}.`;
					changed = true;
				}
				break;
			}
			case 'complete':
			default:
				break;
		}

		if (changed) {
			this.syncCargoPositions();
		}

		return changed;
	}

	getSnapshot(): ForkliftSimulationSnapshot {
		const loads = Array.from({ length: TOTAL_LOADS }, (_, index) => this.buildLoadPackageState(index));
		const telemetry = this.createTelemetryModels();

		return {
			phase: this.phase,
			message: this.message,
			forklift: {
				position: cloneVector3(this.forkliftPosition),
				rotationY: this.forkliftRotationY,
				forkHeight: this.forkHeight
			},
			pallet: this.buildPalletState(),
			boxes: this.buildBoxesState(),
			rack: this.buildRackState(),
			loads,
			deliveredLoads: this.deliveredLoads.map((load) => ({
				id: load.id,
				pallet: {
					...load.pallet,
					position: cloneVector3(load.pallet.position),
					dimensions: { ...load.pallet.dimensions }
				},
				boxes: {
					...load.boxes,
					position: cloneVector3(load.boxes.position),
					dimensions: { ...load.boxes.dimensions }
				},
				shelfIndex: load.shelfIndex
			})),
			activeLoadIndex: this.activeLoadIndex,
			totalLoads: TOTAL_LOADS,
			autoPilot: this.autoPilot,
			carryingPallet: this.carryingPallet,
			completed: this.completed,
			telemetry
		};
	}

	getTelemetryModels(): ModelTelemetry[] {
		return this.createTelemetryModels();
	}

	describe(): string {
		const snapshot = this.getSnapshot();
		return `${snapshot.message} · fase=${snapshot.phase} · fork=${formatFacing(snapshot.forklift.rotationY)} · carrying=${snapshot.carryingPallet ? 'sí' : 'no'} · carga=${snapshot.activeLoadIndex + 1}/${snapshot.totalLoads}`;
	}

	private createTelemetryModels(): ModelTelemetry[] {
		const timestamp = new Date().toISOString();
		const rackShelfDimensions: Dimensions3D = {
			width: DEFAULT_DIMENSIONS.rack.width - 0.3,
			height: 0.08,
			depth: DEFAULT_DIMENSIONS.rack.depth
		};

		const loadModels = Array.from({ length: TOTAL_LOADS }, (_, index) =>
			this.createLoadTelemetry(index, timestamp)
		).flat();

		return [
			createDemoTelemetry(
				'Forklift',
				this.forkliftPosition,
				DEFAULT_DIMENSIONS.forklift,
				timestamp,
				'demo',
				'center',
				this.forkliftRotationY
			),
			createDemoTelemetry(
				'Pallet',
				this.palletPosition,
				DEFAULT_DIMENSIONS.pallet,
				timestamp,
				'demo',
				'base'
			),
			createDemoTelemetry(
				'Boxes',
				this.boxesPosition,
				DEFAULT_DIMENSIONS.boxes,
				timestamp,
				'demo',
				'base'
			),
			createDemoTelemetry(
				'Rack',
				this.rackPosition,
				DEFAULT_DIMENSIONS.rack,
				timestamp,
				'demo',
				'base',
				RACK_ROTATION_Y
			),
			...RACK_SHELF_LEVELS.map((level, index) =>
				createDemoTelemetry(
					`Rack shelf ${index + 1}`,
					{
						x: this.rackPosition.x,
						y: level.beamY,
						z: this.rackPosition.z
					},
					rackShelfDimensions,
					timestamp,
					'demo',
					'base',
					RACK_ROTATION_Y,
					'rack',
					level.component
				)
			),
			...loadModels
		];
	}

	private buildPalletState(): SceneObjectState {
		const loadNumber = Math.min(this.activeLoadIndex, TOTAL_LOADS - 1) + 1;
		return objectState(
			'pallet',
			`Caja ${loadNumber}`,
			cloneVector3(this.palletPosition),
			DEFAULT_DIMENSIONS.pallet
		);
	}

	private buildBoxesState(): SceneObjectState {
		const loadNumber = Math.min(this.activeLoadIndex, TOTAL_LOADS - 1) + 1;
		return objectState(
			'boxes',
			`Caja ${loadNumber} carga`,
			cloneVector3(this.boxesPosition),
			DEFAULT_DIMENSIONS.boxes
		);
	}

	private buildRackState(): SceneObjectState {
		return objectState('rack', 'Rack', cloneVector3(this.rackPosition), DEFAULT_DIMENSIONS.rack);
	}

	private buildSourceLoadPosition(loadIndex: number): Vector3 {
		return cloneVector3(LOAD_SOURCE_POSITIONS[loadIndex]);
	}

	private buildRackLoadPosition(loadIndex: number): Vector3 {
		const shelf = RACK_SHELF_LEVELS[0];
		return {
			x: this.rackPosition.x,
			y: shelf.cargoY,
			z: this.rackPosition.z + LOAD_RACK_SLOT_OFFSETS[loadIndex]
		};
	}

	private buildWaitingLoadState(loadIndex: number): LoadPackageState {
		const loadNumber = loadIndex + 1;
		const palletPosition = this.buildSourceLoadPosition(loadIndex);
		const boxesPosition = {
			x: palletPosition.x,
			y: palletPosition.y + PALLET_THICKNESS,
			z: palletPosition.z
		};

		return {
			id: `load-${loadNumber}`,
			pallet: objectState(
				'pallet',
				`Caja ${loadNumber}`,
				palletPosition,
				DEFAULT_DIMENSIONS.pallet
			),
			boxes: objectState(
				'boxes',
				`Caja ${loadNumber} carga`,
				boxesPosition,
				DEFAULT_DIMENSIONS.boxes
			)
		};
	}

	private buildActiveLoadState(loadIndex: number): LoadPackageState {
		const loadNumber = loadIndex + 1;
		const palletPosition = cloneVector3(this.palletPosition);
		const boxesPosition = {
			x: palletPosition.x,
			y: palletPosition.y + PALLET_THICKNESS,
			z: palletPosition.z
		};

		return {
			id: `load-${loadNumber}`,
			pallet: objectState(
				'pallet',
				`Caja ${loadNumber}`,
				palletPosition,
				DEFAULT_DIMENSIONS.pallet
			),
			boxes: objectState(
				'boxes',
				`Caja ${loadNumber} carga`,
				boxesPosition,
				DEFAULT_DIMENSIONS.boxes
			)
		};
	}

	private buildDeliveredLoadState(loadIndex: number): DeliveredLoadState {
		const loadNumber = loadIndex + 1;
		const palletPosition = this.buildRackLoadPosition(loadIndex);
		const boxesPosition = {
			x: palletPosition.x,
			y: palletPosition.y + PALLET_THICKNESS,
			z: palletPosition.z
		};

		return {
			id: `rack-load-${loadNumber}`,
			shelfIndex: 0,
			pallet: objectState(
				'pallet',
				`Rack caja ${loadNumber}`,
				palletPosition,
				DEFAULT_DIMENSIONS.pallet
			),
			boxes: objectState(
				'boxes',
				`Rack caja ${loadNumber} carga`,
				boxesPosition,
				DEFAULT_DIMENSIONS.boxes
			)
		};
	}

	private buildLoadPackageState(loadIndex: number): LoadPackageState {
		if (loadIndex < this.deliveredLoads.length) {
			const delivered = this.deliveredLoads[loadIndex];

			return {
				id: delivered.id,
				pallet: {
					...delivered.pallet,
					position: cloneVector3(delivered.pallet.position),
					dimensions: { ...delivered.pallet.dimensions }
				},
				boxes: {
					...delivered.boxes,
					position: cloneVector3(delivered.boxes.position),
					dimensions: { ...delivered.boxes.dimensions }
				},
				shelfIndex: delivered.shelfIndex
			};
		}

		if (loadIndex === this.deliveredLoads.length && !this.completed) {
			return this.carryingPallet ? this.buildActiveLoadState(loadIndex) : this.buildWaitingLoadState(loadIndex);
		}

		return this.buildWaitingLoadState(loadIndex);
	}

	private createLoadTelemetry(loadIndex: number, timestamp: string): ModelTelemetry[] {
		const loadNumber = loadIndex + 1;
		const isDelivered = loadIndex < this.deliveredLoads.length;
		const isActive = loadIndex === this.deliveredLoads.length && !this.completed;
		const rotationY = isDelivered
			? RACK_ROTATION_Y
			: isActive && this.carryingPallet
				? this.forkliftRotationY
				: 0;
		const source = isDelivered || isActive ? 'websocket' : 'demo';
		const palletPosition = isDelivered
			? this.buildRackLoadPosition(loadIndex)
			: isActive && this.carryingPallet
				? cloneVector3(this.palletPosition)
				: this.buildSourceLoadPosition(loadIndex);
		const boxesPosition = {
			x: palletPosition.x,
			y: palletPosition.y + PALLET_THICKNESS,
			z: palletPosition.z
		};

		return [
			createDemoTelemetry(
				isDelivered ? `Rack caja ${loadNumber}` : `Caja ${loadNumber}`,
				palletPosition,
				DEFAULT_DIMENSIONS.pallet,
				timestamp,
				source,
				'base',
				rotationY,
				isDelivered ? 'rack' : undefined,
				isDelivered ? `shelf-1-slot-${loadNumber}` : undefined
			),
			createDemoTelemetry(
				isDelivered ? `Rack caja ${loadNumber} carga` : `Caja ${loadNumber} carga`,
				boxesPosition,
				DEFAULT_DIMENSIONS.boxes,
				timestamp,
				source,
				'base',
				rotationY,
				isDelivered ? 'rack' : 'pallet',
				isDelivered ? `shelf-1-slot-${loadNumber}-cargo` : 'cargo'
			)
		];
	}

	private palletPickTarget(): Vector3 {
		const loadPosition = this.buildSourceLoadPosition(this.activeLoadIndex);
		return {
			x: loadPosition.x - CARGO_CARRY_OFFSET_X,
			y: loadPosition.y,
			z: loadPosition.z
		};
	}

	private rackApproachTarget(): Vector3 {
		const rackLoadPosition = this.buildRackLoadPosition(this.activeLoadIndex);
		return {
			x: rackLoadPosition.x - CARGO_CARRY_OFFSET_X,
			y: rackLoadPosition.y,
			z: rackLoadPosition.z
		};
	}

	private translate(distance: number): void {
		const forward = forwardVector(this.forkliftRotationY);
		const delta = scaleVector(forward, distance);
		this.forkliftPosition = addVector(this.forkliftPosition, delta);
		this.syncCargoPositions();
	}

	private driveToward(target: Vector3, dt: number, speed: number): boolean {
		const vector = {
			x: target.x - this.forkliftPosition.x,
			y: 0,
			z: target.z - this.forkliftPosition.z
		};
		const length = Math.hypot(vector.x, vector.z);

		if (length < 0.001) {
			return false;
		}

		const maxStep = speed * dt;
		const step = Math.min(maxStep, length);
		const normalized = {
			x: vector.x / length,
			y: 0,
			z: vector.z / length
		};
		const desiredRotation = Math.atan2(normalized.z, normalized.x);
		const maxTurn = degreesToRadians(this.config.forkliftTurnSpeedDeg) * dt;
		const rotationDelta = normalizeAngle(desiredRotation - this.forkliftRotationY);

		this.forkliftRotationY = rotateTowards(this.forkliftRotationY, desiredRotation, maxTurn);

		if (Math.abs(rotationDelta) > 0.12) {
			this.syncCargoPositions();
			return true;
		}

		const forward = forwardVector(this.forkliftRotationY);
		this.forkliftPosition = addVector(this.forkliftPosition, scaleVector(forward, step));
		this.syncCargoPositions();
		return step > 0;
	}

	private adjustForkHeight(target: number, dt: number): boolean {
		const previous = this.forkHeight;
		const delta = this.config.forkHeightSpeed * dt;

		if (Math.abs(this.forkHeight - target) <= delta) {
			this.forkHeight = target;
		} else if (this.forkHeight < target) {
			this.forkHeight += delta;
		} else {
			this.forkHeight -= delta;
		}

		this.forkHeight = clamp(
			this.forkHeight,
			this.config.forkDownHeight,
			this.config.forkLiftHeight
		);
		this.syncCargoPositions();
		return Math.abs(previous - this.forkHeight) > 0.0001;
	}

	private attachPallet(): void {
		this.carryingPallet = true;
		this.syncCargoPositions();
	}

	private detachPallet(): void {
		this.carryingPallet = false;
		this.deliveredLoads = [...this.deliveredLoads, this.buildDeliveredLoadState(this.activeLoadIndex)];
		this.activeLoadIndex += 1;

		if (this.activeLoadIndex >= TOTAL_LOADS) {
			this.activeLoadIndex = TOTAL_LOADS - 1;
			this.palletPosition = this.buildRackLoadPosition(this.activeLoadIndex);
			this.boxesPosition = {
				x: this.palletPosition.x,
				y: this.palletPosition.y + PALLET_THICKNESS,
				z: this.palletPosition.z
			};
			this.phase = 'complete';
			this.message = 'Las 3 cajas quedaron colocadas en el primer nivel del rack.';
			this.completed = true;
			return;
		}

		this.phase = 'return-to-pallet';
		this.message = `Regresando por la caja ${this.activeLoadIndex + 1} de ${TOTAL_LOADS}.`;
		this.palletPosition = this.buildSourceLoadPosition(this.activeLoadIndex);
		this.boxesPosition = {
			x: this.palletPosition.x,
			y: this.palletPosition.y + PALLET_THICKNESS,
			z: this.palletPosition.z
		};
		this.syncCargoPositions();
	}

	private syncCargoPositions(): void {
		if (this.carryingPallet) {
			const forward = forwardVector(this.forkliftRotationY);
			const palletCenter = addVector(
				this.forkliftPosition,
				scaleVector(forward, CARGO_CARRY_OFFSET_X)
			);
			this.palletPosition = {
				x: palletCenter.x,
				y: this.forkHeight - FORK_TOP_OFFSET_Y,
				z: palletCenter.z
			};
		}

		this.boxesPosition = {
			x: this.palletPosition.x,
			y: this.palletPosition.y + PALLET_THICKNESS,
			z: this.palletPosition.z
		};
	}
}

export function createForkliftSimulation(
	config: Partial<ForkliftSimulationConfig> = {}
): ForkliftSimulation {
	return new ForkliftSimulation(config);
}
