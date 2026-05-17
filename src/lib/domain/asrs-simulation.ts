import {
	createDemoTelemetry,
	type Dimensions3D,
	type ModelTelemetry,
	type Vector3
} from './model-telemetry';

export type AsrsPhase =
	| 'approach-load'
	| 'pick-load'
	| 'lift-load'
	| 'travel-to-rack'
	| 'place-load'
	| 'recover-load'
	| 'return-to-load'
	| 'complete';

export type SceneObjectKind = 'asrs' | 'shuttle' | 'pallet' | 'boxes' | 'rack' | 'track';

export type SceneObjectState = Readonly<{
	kind: SceneObjectKind;
	name: string;
	position: Vector3;
	dimensions: Dimensions3D;
}>;

export type LoadPackageState = Readonly<{
	id: string;
	pallet: SceneObjectState;
	boxes: SceneObjectState;
	shelfIndex?: number;
}>;

export type DeliveredLoadState = Readonly<{
	id: string;
	pallet: SceneObjectState;
	boxes: SceneObjectState;
	shelfIndex: number;
}>;

export type AsrsKinematics = Readonly<{
	position: Vector3;
	shuttlePosition: Vector3;
	carriageHeight: number;
	forkExtension: number;
}>;

export type AsrsSimulationSnapshot = Readonly<{
	phase: AsrsPhase;
	message: string;
	asrs: AsrsKinematics;
	pallet: SceneObjectState;
	boxes: SceneObjectState;
	rack: SceneObjectState;
	track: SceneObjectState;
	loads: LoadPackageState[];
	deliveredLoads: DeliveredLoadState[];
	activeLoadIndex: number;
	totalLoads: number;
	autoPilot: boolean;
	carryingLoad: boolean;
	completed: boolean;
	telemetry: ModelTelemetry[];
}>;

export type AsrsSimulationConfig = Readonly<{
	shuttleSpeed: number;
	carriageSpeed: number;
	forkSpeed: number;
	travelHeight: number;
	pickHeight: number;
	placeHeight: number;
	forkRetracted: number;
	forkInserted: number;
	pickupDistance: number;
	placeDistance: number;
}>;

const DEFAULT_CONFIG: AsrsSimulationConfig = Object.freeze({
	shuttleSpeed: 1.15,
	carriageSpeed: 0.45,
	forkSpeed: 0.7,
	travelHeight: 1.48,
	pickHeight: 0.24,
	placeHeight: 0.78,
	forkRetracted: 0.24,
	forkInserted: 0.95,
	pickupDistance: 0.12,
	placeDistance: 0.12
});

const DEFAULT_DIMENSIONS = Object.freeze({
	asrs: Object.freeze({ width: 2.9, height: 5.9, depth: 1.8 }),
	shuttle: Object.freeze({ width: 1.55, height: 0.65, depth: 0.8 }),
	pallet: Object.freeze({ width: 1.25, height: 0.14, depth: 1.0 }),
	boxes: Object.freeze({ width: 0.88, height: 0.42, depth: 0.34 }),
	rack: Object.freeze({ width: 5.4, height: 4.8, depth: 1.5 }),
	track: Object.freeze({ width: 1.1, height: 0.12, depth: 4.1 }),
	mast: Object.freeze({ width: 0.22, height: 5.4, depth: 0.2 }),
	carriage: Object.freeze({ width: 1.65, height: 0.5, depth: 0.58 }),
	forks: Object.freeze({ width: 1.2, height: 0.08, depth: 0.18 })
});

const MACHINE_POSITION: Vector3 = Object.freeze({ x: -1.8, y: 0, z: 0 });
const BAND_X = 0.72;
const RACK_X = 4.2;
const FLOOR_Y = 0;
const BAND_Y = FLOOR_Y + 0.07;
const LANE_OFFSETS = [-1.15, 0, 1.15] as const;
const RACK_SHELF_LEVELS = [
	{ beamY: 0.7, cargoY: 0.78, component: 'shelf-1' },
	{ beamY: 1.58, cargoY: 1.66, component: 'shelf-2' },
	{ beamY: 2.46, cargoY: 2.54, component: 'shelf-3' },
	{ beamY: 3.34, cargoY: 3.42, component: 'shelf-4' }
] as const;
const LOAD_SOURCE_POSITIONS = LANE_OFFSETS.map((z) => ({ x: BAND_X, y: BAND_Y, z })) as readonly Vector3[];
// Order matches the requested 3-2-1 layout from right to left.
const LOAD_RACK_SLOT_OFFSETS = [1.8, 0, -1.8] as const;
const RACK_LOAD_Z = 0;
const RACK_APPROACH_Z = RACK_LOAD_Z - 0.9;
const TOTAL_LOADS = LOAD_SOURCE_POSITIONS.length;

function cloneVector3(value: Vector3): Vector3 {
	return { x: value.x, y: value.y, z: value.z };
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
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

function planarDistance(left: Vector3, right: Vector3): number {
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

function formatNumber(value: number, fractionDigits = 2): string {
	return new Intl.NumberFormat('es-ES', {
		maximumFractionDigits: fractionDigits,
		minimumFractionDigits: fractionDigits
	}).format(value);
}

export class AsrsSimulation {
	private readonly config: AsrsSimulationConfig;
	private phase: AsrsPhase = 'approach-load';
	private message = 'El ASRS está buscando la caja 1 de 3 en la banda de entrada.';
	private shuttlePosition: Vector3 = cloneVector3(LOAD_SOURCE_POSITIONS[0]);
	private carriageHeight = DEFAULT_CONFIG.pickHeight;
	private forkExtension = DEFAULT_CONFIG.forkRetracted;
	private palletPosition: Vector3 = cloneVector3(LOAD_SOURCE_POSITIONS[0]);
	private boxesPosition: Vector3 = {
		x: LOAD_SOURCE_POSITIONS[0].x,
		y: LOAD_SOURCE_POSITIONS[0].y + DEFAULT_DIMENSIONS.pallet.height,
		z: LOAD_SOURCE_POSITIONS[0].z
	};
	private rackPosition: Vector3 = Object.freeze({ x: RACK_X, y: 0, z: 0 });
	private bandPosition: Vector3 = Object.freeze({ x: BAND_X, y: 0, z: 0 });
	private deliveredLoads: DeliveredLoadState[] = [];
	private activeLoadIndex = 0;
	private carryingLoad = false;
	private autoPilot = true;
	private completed = false;

	constructor(config: Partial<AsrsSimulationConfig> = {}) {
		this.config = {
			...DEFAULT_CONFIG,
			...config
		};
		this.syncCargoPositions();
	}

	reset(): void {
		this.phase = 'approach-load';
		this.message = 'El ASRS está buscando la caja 1 de 3 en la banda de entrada.';
		this.shuttlePosition = cloneVector3(LOAD_SOURCE_POSITIONS[0]);
		this.carriageHeight = this.config.pickHeight;
		this.forkExtension = this.config.forkRetracted;
		this.palletPosition = cloneVector3(LOAD_SOURCE_POSITIONS[0]);
		this.boxesPosition = {
			x: this.palletPosition.x,
			y: this.palletPosition.y + DEFAULT_DIMENSIONS.pallet.height,
			z: this.palletPosition.z
		};
		this.deliveredLoads = [];
		this.activeLoadIndex = 0;
		this.carryingLoad = false;
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

	update(dt: number): boolean {
		if (!this.autoPilot || this.completed) {
			this.syncCargoPositions();
			return false;
		}

		let changed = false;

		switch (this.phase) {
			case 'approach-load': {
				changed = this.driveShuttleToward(this.palletPickTarget(), dt);
				if (planarDistance(this.shuttlePosition, this.palletPickTarget()) <= this.config.pickupDistance) {
					this.phase = 'pick-load';
					this.message = 'Alineando el shuttle con la caja de entrada.';
					changed = true;
				}
				break;
			}
			case 'pick-load': {
				changed =
					this.adjustCarriageHeight(this.config.pickHeight, dt) ||
					this.adjustForkExtension(this.config.forkInserted, dt) ||
					changed;
				if (
					Math.abs(this.carriageHeight - this.config.pickHeight) <= 0.01 &&
					Math.abs(this.forkExtension - this.config.forkInserted) <= 0.01
				) {
					this.attachLoad();
					this.phase = 'lift-load';
					this.message = 'Levantando la caja desde la banda.';
					changed = true;
				}
				break;
			}
			case 'lift-load': {
				changed = this.adjustCarriageHeight(this.config.travelHeight, dt) || changed;
				if (Math.abs(this.carriageHeight - this.config.travelHeight) <= 0.01) {
					this.phase = 'travel-to-rack';
					this.message = 'Trasladando la caja hacia el rack.';
					changed = true;
				}
				break;
			}
			case 'travel-to-rack': {
				changed = this.driveShuttleToward(this.rackApproachTarget(), dt) || changed;
				if (
					planarDistance(this.shuttlePosition, this.rackApproachTarget()) <= this.config.placeDistance
				) {
					this.phase = 'place-load';
					this.message = 'Posicionando la caja frente al primer nivel del rack.';
					changed = true;
				}
				break;
			}
			case 'place-load': {
				changed =
					this.adjustCarriageHeight(this.config.placeHeight, dt) ||
					this.adjustForkExtension(this.config.forkInserted, dt) ||
					changed;
				if (
					Math.abs(this.carriageHeight - this.config.placeHeight) <= 0.01 &&
					Math.abs(this.forkExtension - this.config.forkInserted) <= 0.01
				) {
					const completed = this.detachLoad();
					if (completed) {
						this.phase = 'complete';
						this.message = 'Las 3 cajas quedaron colocadas en el primer nivel del rack.';
					} else {
						this.phase = 'recover-load';
						this.message = 'Retirando el shuttle del rack.';
					}
					changed = true;
				}
				break;
			}
			case 'recover-load': {
				changed =
					this.adjustCarriageHeight(this.config.travelHeight, dt) ||
					this.adjustForkExtension(this.config.forkRetracted, dt) ||
					changed;
				if (
					Math.abs(this.carriageHeight - this.config.travelHeight) <= 0.01 &&
					Math.abs(this.forkExtension - this.config.forkRetracted) <= 0.01
				) {
					this.phase = 'return-to-load';
					this.message = `Regresando por la caja ${this.activeLoadIndex + 1} de ${TOTAL_LOADS}.`;
					changed = true;
				}
				break;
			}
			case 'return-to-load': {
				changed = this.driveShuttleToward(this.palletPickTarget(), dt) || changed;
				if (planarDistance(this.shuttlePosition, this.palletPickTarget()) <= this.config.pickupDistance) {
					this.phase = 'approach-load';
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

	getSnapshot(): AsrsSimulationSnapshot {
		const loads = Array.from({ length: TOTAL_LOADS }, (_, index) => this.buildLoadPackageState(index));
		const telemetry = this.createTelemetryModels();

		return {
			phase: this.phase,
			message: this.message,
			asrs: {
				position: cloneVector3(MACHINE_POSITION),
				shuttlePosition: cloneVector3(this.shuttlePosition),
				carriageHeight: this.carriageHeight,
				forkExtension: this.forkExtension
			},
			pallet: this.buildPalletState(),
			boxes: this.buildBoxesState(),
			rack: this.buildRackState(),
			track: this.buildBandState(),
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
			carryingLoad: this.carryingLoad,
			completed: this.completed,
			telemetry
		};
	}

	getTelemetryModels(): ModelTelemetry[] {
		return this.createTelemetryModels();
	}

	describe(): string {
		const snapshot = this.getSnapshot();
		const activeLoadNumber = Math.min(snapshot.activeLoadIndex, snapshot.totalLoads - 1) + 1;
		return `${snapshot.message} · fase=${snapshot.phase} · shuttle=(${formatNumber(snapshot.asrs.shuttlePosition.x)}, ${formatNumber(snapshot.asrs.shuttlePosition.z)}) · carro=${formatNumber(snapshot.asrs.carriageHeight)}m · carga=${activeLoadNumber}/${snapshot.totalLoads}`;
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
				'ASRS frame',
				MACHINE_POSITION,
				DEFAULT_DIMENSIONS.asrs,
				timestamp,
				'demo',
				'base',
				0,
				'ASRS-01',
				'frame'
			),
			createDemoTelemetry(
				'ASRS shuttle',
				this.shuttleTelemetryPosition(),
				DEFAULT_DIMENSIONS.shuttle,
				timestamp,
				'demo',
				'center',
				0,
				'ASRS-01',
				'shuttle'
			),
			createDemoTelemetry(
				'ASRS carriage',
				this.carriageTelemetryPosition(),
				DEFAULT_DIMENSIONS.carriage,
				timestamp,
				'demo',
				'center',
				0,
				'ASRS-01',
				'carriage'
			),
			createDemoTelemetry(
				'ASRS forks',
				this.forksTelemetryPosition(),
				this.forksTelemetryDimensions(),
				timestamp,
				'demo',
				'center',
				0,
				'ASRS-01',
				'forks'
			),
			createDemoTelemetry(
				'ASRS conveyor',
				this.bandPosition,
				DEFAULT_DIMENSIONS.track,
				timestamp,
				'demo',
				'base',
				0,
				'ASRS-01',
				'band'
			),
			createDemoTelemetry(
				'Rack',
				this.rackPosition,
				DEFAULT_DIMENSIONS.rack,
				timestamp,
				'demo',
				'base',
				Math.PI / 2,
				'rack',
				'frame'
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
					Math.PI / 2,
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

	private buildBandState(): SceneObjectState {
		return objectState('track', 'Banda ASRS', cloneVector3(this.bandPosition), DEFAULT_DIMENSIONS.track);
	}

	private buildSourceLoadPosition(loadIndex: number): Vector3 {
		return cloneVector3(LOAD_SOURCE_POSITIONS[loadIndex]);
	}

	private buildRackLoadPosition(loadIndex: number): Vector3 {
		const shelf = RACK_SHELF_LEVELS[0];
		return {
			x: this.rackPosition.x + LOAD_RACK_SLOT_OFFSETS[loadIndex],
			y: shelf.cargoY,
			z: this.rackPosition.z + RACK_LOAD_Z
		};
	}

	private buildWaitingLoadState(loadIndex: number): LoadPackageState {
		const loadNumber = loadIndex + 1;
		const palletPosition = this.buildSourceLoadPosition(loadIndex);
		const boxesPosition = {
			x: palletPosition.x,
			y: palletPosition.y + DEFAULT_DIMENSIONS.pallet.height,
			z: palletPosition.z
		};

		return {
			id: `load-${loadNumber}`,
			pallet: objectState('pallet', `Caja ${loadNumber}`, palletPosition, DEFAULT_DIMENSIONS.pallet),
			boxes: objectState('boxes', `Caja ${loadNumber} carga`, boxesPosition, DEFAULT_DIMENSIONS.boxes)
		};
	}

	private buildActiveLoadState(loadIndex: number): LoadPackageState {
		const loadNumber = loadIndex + 1;
		const palletPosition = cloneVector3(this.palletPosition);
		const boxesPosition = {
			x: palletPosition.x,
			y: palletPosition.y + DEFAULT_DIMENSIONS.pallet.height,
			z: palletPosition.z
		};

		return {
			id: `load-${loadNumber}`,
			pallet: objectState('pallet', `Caja ${loadNumber}`, palletPosition, DEFAULT_DIMENSIONS.pallet),
			boxes: objectState('boxes', `Caja ${loadNumber} carga`, boxesPosition, DEFAULT_DIMENSIONS.boxes)
		};
	}

	private buildDeliveredLoadState(loadIndex: number): DeliveredLoadState {
		const loadNumber = loadIndex + 1;
		const palletPosition = this.buildRackLoadPosition(loadIndex);
		const boxesPosition = {
			x: palletPosition.x,
			y: palletPosition.y + DEFAULT_DIMENSIONS.pallet.height,
			z: palletPosition.z
		};

		return {
			id: `rack-load-${loadNumber}`,
			shelfIndex: 0,
			pallet: objectState('pallet', `Rack caja ${loadNumber}`, palletPosition, DEFAULT_DIMENSIONS.pallet),
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
			return this.carryingLoad
				? this.buildActiveLoadState(loadIndex)
				: this.buildWaitingLoadState(loadIndex);
		}

		return this.buildWaitingLoadState(loadIndex);
	}

	private createLoadTelemetry(loadIndex: number, timestamp: string): ModelTelemetry[] {
		const loadNumber = loadIndex + 1;
		const isDelivered = loadIndex < this.deliveredLoads.length;
		const isActive = loadIndex === this.deliveredLoads.length && !this.completed;
		const loadPosition = isDelivered
			? this.buildRackLoadPosition(loadIndex)
			: isActive && this.carryingLoad
				? cloneVector3(this.palletPosition)
				: this.buildSourceLoadPosition(loadIndex);
		const rotationY = isDelivered ? Math.PI / 2 : 0;
		const source = isDelivered || isActive ? 'websocket' : 'demo';
		const partOf = isDelivered ? 'rack' : 'band';
		const component = isDelivered ? `shelf-1-slot-${loadNumber}` : 'pallet';

		return [
			createDemoTelemetry(
				isDelivered ? `Rack caja ${loadNumber}` : `Caja ${loadNumber}`,
				loadPosition,
				DEFAULT_DIMENSIONS.pallet,
				timestamp,
				source,
				'base',
				rotationY,
				partOf,
				component
			),
			createDemoTelemetry(
				isDelivered ? `Rack caja ${loadNumber} carga` : `Caja ${loadNumber} carga`,
				{
					x: loadPosition.x,
					y: loadPosition.y + DEFAULT_DIMENSIONS.pallet.height,
					z: loadPosition.z
				},
				DEFAULT_DIMENSIONS.boxes,
				timestamp,
				source,
				'base',
				rotationY,
				partOf,
				isDelivered ? `shelf-1-slot-${loadNumber}-cargo` : 'cargo'
			)
		];
	}

	private palletPickTarget(): Vector3 {
		const loadPosition = this.buildSourceLoadPosition(this.activeLoadIndex);
		return {
			x: loadPosition.x,
			y: loadPosition.y,
			z: loadPosition.z
		};
	}

	private rackApproachTarget(): Vector3 {
		const rackLoadPosition = this.buildRackLoadPosition(this.activeLoadIndex);
		return {
			x: rackLoadPosition.x,
			y: rackLoadPosition.y,
			z: RACK_APPROACH_Z
		};
	}

	private driveShuttleToward(target: Vector3, dt: number): boolean {
		const vector = {
			x: target.x - this.shuttlePosition.x,
			y: 0,
			z: target.z - this.shuttlePosition.z
		};
		const length = Math.hypot(vector.x, vector.z);

		if (length < 0.0001) {
			return false;
		}

		const maxStep = this.config.shuttleSpeed * dt;
		const step = Math.min(maxStep, length);
		const normalized = {
			x: vector.x / length,
			y: 0,
			z: vector.z / length
		};

		this.shuttlePosition = addVector(this.shuttlePosition, scaleVector(normalized, step));
		this.syncCargoPositions();
		return step > 0;
	}

	private adjustCarriageHeight(target: number, dt: number): boolean {
		const previous = this.carriageHeight;
		const delta = this.config.carriageSpeed * dt;

		if (Math.abs(this.carriageHeight - target) <= delta) {
			this.carriageHeight = target;
		} else if (this.carriageHeight < target) {
			this.carriageHeight += delta;
		} else {
			this.carriageHeight -= delta;
		}

		this.carriageHeight = clamp(this.carriageHeight, this.config.pickHeight, this.config.travelHeight);
		this.syncCargoPositions();
		return Math.abs(previous - this.carriageHeight) > 0.0001;
	}

	private adjustForkExtension(target: number, dt: number): boolean {
		const previous = this.forkExtension;
		const delta = this.config.forkSpeed * dt;

		if (Math.abs(this.forkExtension - target) <= delta) {
			this.forkExtension = target;
		} else if (this.forkExtension < target) {
			this.forkExtension += delta;
		} else {
			this.forkExtension -= delta;
		}

		this.forkExtension = clamp(
			this.forkExtension,
			this.config.forkRetracted,
			this.config.forkInserted
		);
		this.syncCargoPositions();
		return Math.abs(previous - this.forkExtension) > 0.0001;
	}

	private attachLoad(): void {
		this.carryingLoad = true;
		this.syncCargoPositions();
	}

	private detachLoad(): boolean {
		this.carryingLoad = false;
		this.deliveredLoads = [...this.deliveredLoads, this.buildDeliveredLoadState(this.activeLoadIndex)];
		this.activeLoadIndex += 1;
		if (this.activeLoadIndex >= TOTAL_LOADS) {
			this.activeLoadIndex = TOTAL_LOADS - 1;
			this.completed = true;
		}
		this.syncCargoPositions();
		return this.completed;
	}

	private syncCargoPositions(): void {
		if (this.carryingLoad) {
			this.palletPosition = {
				x: this.shuttlePosition.x,
				y: this.carriageHeight - 0.1,
				z: this.shuttlePosition.z
			};
		} else if (!this.completed) {
			this.palletPosition = this.buildSourceLoadPosition(this.activeLoadIndex);
		}

		this.boxesPosition = {
			x: this.palletPosition.x,
			y: this.palletPosition.y + DEFAULT_DIMENSIONS.pallet.height,
			z: this.palletPosition.z
		};
	}

	private shuttleTelemetryPosition(): Vector3 {
		return {
			x: this.shuttlePosition.x,
			y: this.carriageHeight,
			z: this.shuttlePosition.z
		};
	}

	private carriageTelemetryPosition(): Vector3 {
		return {
			x: this.shuttlePosition.x + 0.18,
			y: this.carriageHeight,
			z: this.shuttlePosition.z
		};
	}

	private forksTelemetryPosition(): Vector3 {
		return {
			x: this.shuttlePosition.x + 0.78,
			y: this.carriageHeight - 0.08,
			z: this.shuttlePosition.z
		};
	}

	private forksTelemetryDimensions(): Dimensions3D {
		return {
			width: 1.1 + this.forkExtension,
			height: DEFAULT_DIMENSIONS.forks.height,
			depth: DEFAULT_DIMENSIONS.forks.depth
		};
	}
}

export function createAsrsSimulation(
	config: Partial<AsrsSimulationConfig> = {}
): AsrsSimulation {
	return new AsrsSimulation(config);
}
