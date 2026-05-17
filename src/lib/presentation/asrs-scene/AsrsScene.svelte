<script lang="ts">
	import { onMount } from 'svelte';

	import { createAsrsSceneController } from '$lib/application/asrs-scene-controller';
	import type { AsrsSimulationSnapshot } from '$lib/domain/asrs-simulation';
	import { formatDimensions3D, formatTimestamp, formatVector3 } from '$lib/domain/model-telemetry';
	import { formatSceneControlLabel, parseSceneControlMessage } from '$lib/domain/scene-control';
	import { ModelTelemetrySocketClient } from '$lib/infrastructure/websocket/model-telemetry-socket';

	type BabylonModule = typeof import('babylonjs');
	type BabylonScene = import('babylonjs').Scene;
	type BabylonStandardMaterial = import('babylonjs').StandardMaterial;

	type LoadPackageHandle = {
		root: {
			position: { set: (x: number, y: number, z: number) => void };
			rotation: { y: number };
			setEnabled: (enabled: boolean) => void;
			parent: unknown;
		};
		palletRoot: {
			position: { set: (x: number, y: number, z: number) => void };
			rotation: { y: number };
		};
		boxesRoot: {
			position: { set: (x: number, y: number, z: number) => void };
			rotation: { y: number };
		};
	};

	type SceneHandles = {
		engine: {
			runRenderLoop: (callback: () => void) => void;
			resize: () => void;
			dispose: () => void;
		};
		scene: { render: () => void; dispose: () => void };
		frameRoot: {
			position: { set: (x: number, y: number, z: number) => void };
		};
		shuttleRoot: {
			position: { set: (x: number, y: number, z: number) => void };
			rotation: { y: number };
		};
		carriageRoot: { position: { y: number } };
		forksRoot: {
			position: { set: (x: number, y: number, z: number) => void };
			rotation: { y: number };
		};
		rackRoot: {
			position: { set: (x: number, y: number, z: number) => void };
			rotation: { y: number };
		};
		bandRoot: {
			position: { set: (x: number, y: number, z: number) => void };
		};
		loadPackages: LoadPackageHandle[];
		syncScene: (state: AsrsSimulationSnapshot) => void;
		dispose: () => void;
	};

	const carriedLoadOffset = Object.freeze({ x: 0.64, y: -0.04, z: 0 });

	const controller = createAsrsSceneController();
	const telemetryPublisher = new ModelTelemetrySocketClient();
	const controlSubscriber = new ModelTelemetrySocketClient();
	const telemetryEndpoint = 'ws://localhost:5173/telemetry';
	const controlEndpoint = 'ws://localhost:5173/control';

	let canvas: HTMLCanvasElement;
	let snapshot = $state(controller.snapshot);
	let summaryText = $state(controller.summary);
	let statusMessage = $state('Preparando la escena...');
	let telemetryStatus = $state('Telemetría websocket: desconectada');
	let controlStatus = $state('Control websocket: desconectado');
	let animationStatus = $state('Animación activa ×1.00');
	let errorMessage = $state('');
	let ready = $state(false);
	let isPaused = $state(false);
	let speedMultiplier = $state(1);
	let lastPublishedSignature = $state('');

	const phaseLabels: Record<AsrsSimulationSnapshot['phase'], string> = {
		'approach-load': 'Aproximándose a la caja',
		'pick-load': 'Alineando el shuttle',
		'lift-load': 'Levantando caja',
		'travel-to-rack': 'Trasladando al rack',
		'place-load': 'Colocando en el rack',
		'recover-load': 'Retirando shuttle',
		'return-to-load': 'Regresando a la banda',
		complete: 'Secuencia completada'
	};

	function refreshState(): void {
		snapshot = controller.snapshot;
		summaryText = controller.summary;
		statusMessage = phaseLabels[snapshot.phase];
	}

	function resetScene(): void {
		controller.reset();
		refreshState();
	}

	function startDemo(): void {
		controller.startAutoPilot();
		refreshState();
	}

	function stopDemo(): void {
		controller.stopAutoPilot();
		refreshState();
	}

	function updateAnimationStatus(): void {
		animationStatus = isPaused
			? `Animación en pausa · velocidad ×${speedMultiplier.toFixed(2)}`
			: `Animación activa · velocidad ×${speedMultiplier.toFixed(2)}`;
	}

	function clampSpeed(value: number): number {
		return Math.min(3, Math.max(0.25, value));
	}

	function applyControlMessage(raw: string): void {
		const message = parseSceneControlMessage(raw);
		if (!message) {
			return;
		}

		console.log(`[scene-control] ${formatSceneControlLabel(message)}`);

		switch (message.command) {
			case 'pause':
				isPaused = true;
				break;
			case 'resume':
				isPaused = false;
				controller.startAutoPilot();
				refreshState();
				lastPublishedSignature = '';
				break;
			case 'toggle-pause':
				isPaused = !isPaused;
				break;
			case 'speed-up':
				speedMultiplier = clampSpeed(speedMultiplier + 0.2);
				break;
			case 'speed-down':
				speedMultiplier = clampSpeed(speedMultiplier - 0.2);
				break;
			case 'set-speed':
				if (
					typeof message.value === 'number' &&
					Number.isFinite(message.value) &&
					message.value > 0
				) {
					speedMultiplier = clampSpeed(message.value);
				}
				break;
			case 'reset':
				controller.reset();
				isPaused = false;
				speedMultiplier = 1;
				refreshState();
				lastPublishedSignature = '';
				break;
			case 'restart':
				controller.reset();
				controller.startAutoPilot();
				isPaused = false;
				speedMultiplier = 1;
				refreshState();
				lastPublishedSignature = '';
				break;
		}

		updateAnimationStatus();
	}

	function connectTelemetryPublisher(): void {
		telemetryPublisher.connect(telemetryEndpoint, {
			onOpen: () => {
				telemetryStatus = `Telemetría websocket conectada: ${telemetryEndpoint}`;
			},
			onClose: () => {
				telemetryStatus = 'Telemetría websocket desconectada';
			},
			onError: () => {
				telemetryStatus = 'Telemetría websocket con error';
			},
			onMessage: () => {
				// Publicación unidireccional.
			}
		});
	}

	function connectControlSubscriber(): void {
		controlSubscriber.connect(controlEndpoint, {
			onOpen: () => {
				controlStatus = `Control websocket conectado: ${controlEndpoint}`;
			},
			onClose: () => {
				controlStatus = 'Control websocket desconectado';
			},
			onError: () => {
				controlStatus = 'Control websocket con error';
			},
			onMessage: (message) => {
				applyControlMessage(message);
			}
		});
	}

	function publishTelemetryFrame(): void {
		const models = controller.telemetryModels;
		const signature = models
			.map((model) => {
				const position = model.position;
				const dimensions = model.dimensions;
				return [
					model.name,
					position.x.toFixed(2),
					position.y.toFixed(2),
					position.z.toFixed(2),
					dimensions.width.toFixed(2),
					dimensions.height.toFixed(2),
					dimensions.depth.toFixed(2),
					model.rotationY === undefined ? '' : model.rotationY.toFixed(3),
					model.source,
					model.anchor,
					model.partOf ?? '',
					model.component ?? ''
				].join('|');
			})
			.join('::');

		if (signature === lastPublishedSignature) {
			return;
		}

		lastPublishedSignature = signature;

		for (const model of models) {
			telemetryPublisher.send(JSON.stringify(model));
		}
	}

	let scene!: BabylonScene;
	let frameMaterial!: BabylonStandardMaterial;
	let shuttleMaterial!: BabylonStandardMaterial;
	let bandMaterial!: BabylonStandardMaterial;
	let rackMaterial!: BabylonStandardMaterial;
	let rackFrameMaterial!: BabylonStandardMaterial;
	let rackBeamMaterial!: BabylonStandardMaterial;
	let palletMaterial!: BabylonStandardMaterial;
	let woodMaterial!: BabylonStandardMaterial;
	let boxMaterialA!: BabylonStandardMaterial;
	let boxMaterialB!: BabylonStandardMaterial;
	let darkMetalMaterial!: BabylonStandardMaterial;
	let metalMaterial!: BabylonStandardMaterial;

	function createLoadPackage(BABYLON: BabylonModule, prefix: string): LoadPackageHandle {
		const root = new BABYLON.TransformNode(`${prefix}-root`, scene);
		const palletRoot = new BABYLON.TransformNode(`${prefix}-palletRoot`, scene);
		palletRoot.parent = root;

		const palletDeck = BABYLON.MeshBuilder.CreateBox(
			`${prefix}-palletDeck`,
			{ width: 1.25, height: 0.14, depth: 1.0 },
			scene
		);
		palletDeck.parent = palletRoot;
		palletDeck.position.y = 0.07;
		palletDeck.material = palletMaterial;

		[-0.42, 0, 0.42].forEach((offset, index) => {
			const slat = BABYLON.MeshBuilder.CreateBox(
				`${prefix}-palletSlat-${index}`,
				{ width: 1.18, height: 0.05, depth: 0.12 },
				scene
			);
			slat.parent = palletRoot;
			slat.position.set(0, 0.02, offset);
			slat.material = woodMaterial;
		});

		const boxesRoot = new BABYLON.TransformNode(`${prefix}-boxesRoot`, scene);
		boxesRoot.parent = root;
		boxesRoot.position.y = 0.14;

		const boxOne = BABYLON.MeshBuilder.CreateBox(
			`${prefix}-box-1`,
			{ width: 0.42, height: 0.42, depth: 0.34 },
			scene
		);
		boxOne.parent = boxesRoot;
		boxOne.position.set(-0.18, 0.21, 0);
		boxOne.material = boxMaterialA;

		const boxTwo = BABYLON.MeshBuilder.CreateBox(
			`${prefix}-box-2`,
			{ width: 0.42, height: 0.42, depth: 0.34 },
			scene
		);
		boxTwo.parent = boxesRoot;
		boxTwo.position.set(0.18, 0.21, 0);
		boxTwo.material = boxMaterialB;

		return {
			root,
			palletRoot,
			boxesRoot
		};
	}

	function createScene(BABYLON: BabylonModule): SceneHandles {
		const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
		scene = new BABYLON.Scene(engine);
		scene.clearColor = new BABYLON.Color4(0.04, 0.08, 0.16, 1);

		const camera = new BABYLON.ArcRotateCamera(
			'asrsCamera',
			-Math.PI / 2.3,
			Math.PI / 3.35,
			22,
			new BABYLON.Vector3(2.4, 1.8, 0),
			scene
		);
		camera.attachControl(canvas, true);
		camera.lowerRadiusLimit = 10;
		camera.upperRadiusLimit = 34;
		camera.wheelPrecision = 35;
		camera.panningSensibility = 70;

		const hemiLight = new BABYLON.HemisphericLight('hemiLight', new BABYLON.Vector3(0, 1, 0), scene);
		hemiLight.intensity = 1.1;
		hemiLight.groundColor = new BABYLON.Color3(0.16, 0.18, 0.24);

		const dirLight = new BABYLON.DirectionalLight(
			'dirLight',
			new BABYLON.Vector3(-0.3, -1, -0.45),
			scene
		);
		dirLight.position = new BABYLON.Vector3(14, 24, 10);
		dirLight.intensity = 1.6;

		const ground = BABYLON.MeshBuilder.CreateGround('ground', { width: 42, height: 20 }, scene);
		const groundMaterial = new BABYLON.StandardMaterial('groundMaterial', scene);
		groundMaterial.diffuseColor = new BABYLON.Color3(0.1, 0.14, 0.2);
		groundMaterial.specularColor = new BABYLON.Color3(0.02, 0.02, 0.02);
		ground.material = groundMaterial;

		const grid = BABYLON.MeshBuilder.CreateGround('grid', { width: 42, height: 20 }, scene);
		const gridMaterial = new BABYLON.StandardMaterial('gridMaterial', scene);
		gridMaterial.wireframe = true;
		gridMaterial.emissiveColor = new BABYLON.Color3(0.18, 0.28, 0.45);
		gridMaterial.alpha = 0.12;
		grid.material = gridMaterial;
		grid.position.y = 0.01;
		grid.isPickable = false;

		frameMaterial = new BABYLON.StandardMaterial('frameMaterial', scene);
		frameMaterial.diffuseColor = new BABYLON.Color3(0.3, 0.34, 0.4);
		frameMaterial.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		shuttleMaterial = new BABYLON.StandardMaterial('shuttleMaterial', scene);
		shuttleMaterial.diffuseColor = new BABYLON.Color3(0.9, 0.55, 0.2);
		shuttleMaterial.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		bandMaterial = new BABYLON.StandardMaterial('bandMaterial', scene);
		bandMaterial.diffuseColor = new BABYLON.Color3(0.18, 0.22, 0.26);
		bandMaterial.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		rackMaterial = new BABYLON.StandardMaterial('rackMaterial', scene);
		rackMaterial.diffuseColor = new BABYLON.Color3(0.18, 0.2, 0.24);
		rackMaterial.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		rackFrameMaterial = new BABYLON.StandardMaterial('rackFrameMaterial', scene);
		rackFrameMaterial.diffuseColor = new BABYLON.Color3(0.54, 0.58, 0.62);
		rackFrameMaterial.specularColor = new BABYLON.Color3(0.18, 0.18, 0.18);

		rackBeamMaterial = new BABYLON.StandardMaterial('rackBeamMaterial', scene);
		rackBeamMaterial.diffuseColor = new BABYLON.Color3(0.95, 0.45, 0.16);
		rackBeamMaterial.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		palletMaterial = new BABYLON.StandardMaterial('palletMaterial', scene);
		palletMaterial.diffuseColor = new BABYLON.Color3(0.54, 0.36, 0.2);
		palletMaterial.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		woodMaterial = new BABYLON.StandardMaterial('woodMaterial', scene);
		woodMaterial.diffuseColor = new BABYLON.Color3(0.58, 0.42, 0.22);
		woodMaterial.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		boxMaterialA = new BABYLON.StandardMaterial('boxMaterialA', scene);
		boxMaterialA.diffuseColor = new BABYLON.Color3(0.88, 0.55, 0.21);
		boxMaterialA.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		boxMaterialB = new BABYLON.StandardMaterial('boxMaterialB', scene);
		boxMaterialB.diffuseColor = new BABYLON.Color3(0.8, 0.36, 0.33);
		boxMaterialB.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		darkMetalMaterial = new BABYLON.StandardMaterial('darkMetalMaterial', scene);
		darkMetalMaterial.diffuseColor = new BABYLON.Color3(0.12, 0.14, 0.18);
		darkMetalMaterial.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		metalMaterial = new BABYLON.StandardMaterial('metalMaterial', scene);
		metalMaterial.diffuseColor = new BABYLON.Color3(0.28, 0.31, 0.38);
		metalMaterial.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		const frameRoot = new BABYLON.TransformNode('frameRoot', scene);
		const frameBase = BABYLON.MeshBuilder.CreateBox(
			'frameBase',
			{ width: 2.7, height: 0.42, depth: 1.7 },
			scene
		);
		frameBase.parent = frameRoot;
		frameBase.position.set(0, 0.21, 0);
		frameBase.material = frameMaterial;

		const frameCounterweight = BABYLON.MeshBuilder.CreateBox(
			'frameCounterweight',
			{ width: 0.5, height: 0.76, depth: 1.45 },
			scene
		);
		frameCounterweight.parent = frameRoot;
		frameCounterweight.position.set(-0.92, 0.68, 0);
		frameCounterweight.material = darkMetalMaterial;

		const frameCabin = BABYLON.MeshBuilder.CreateBox(
			'frameCabin',
			{ width: 0.9, height: 1.1, depth: 1.0 },
			scene
		);
		frameCabin.parent = frameRoot;
		frameCabin.position.set(-0.08, 1.32, 0);
		frameCabin.material = rackMaterial;

		const mastLeft = BABYLON.MeshBuilder.CreateBox(
			'mastLeft',
			{ width: 0.14, height: 5.2, depth: 0.14 },
			scene
		);
		mastLeft.parent = frameRoot;
		mastLeft.position.set(0.88, 2.6, -0.42);
		mastLeft.material = darkMetalMaterial;

		const mastRight = mastLeft.clone('mastRight');
		if (mastRight) {
			mastRight.parent = frameRoot;
			mastRight.position.set(0.88, 2.6, 0.42);
			mastRight.material = darkMetalMaterial;
		}

		const topBeam = BABYLON.MeshBuilder.CreateBox(
			'topBeam',
			{ width: 3.05, height: 0.12, depth: 0.16 },
			scene
		);
		topBeam.parent = frameRoot;
		topBeam.position.set(0.52, 5.18, 0);
		topBeam.material = frameMaterial;

		const shuttleRoot = new BABYLON.TransformNode('shuttleRoot', scene);
		shuttleRoot.parent = frameRoot;
		shuttleRoot.position.set(0, 0, 0);

		const shuttleBody = BABYLON.MeshBuilder.CreateBox(
			'shuttleBody',
			{ width: 1.45, height: 0.56, depth: 0.74 },
			scene
		);
		shuttleBody.parent = shuttleRoot;
		shuttleBody.position.set(0.7, 2.0, 0);
		shuttleBody.material = shuttleMaterial;

		const carriageRoot = new BABYLON.TransformNode('carriageRoot', scene);
		carriageRoot.parent = shuttleRoot;
		carriageRoot.position.set(0.72, 1.4, 0);

		const carriage = BABYLON.MeshBuilder.CreateBox(
			'carriage',
			{ width: 0.24, height: 0.86, depth: 0.98 },
			scene
		);
		carriage.parent = carriageRoot;
		carriage.position.set(0, 0, 0);
		carriage.material = frameMaterial;

		const forksRoot = new BABYLON.TransformNode('forksRoot', scene);
		forksRoot.parent = carriageRoot;
		forksRoot.position.set(0.7, -0.34, 0);

		const forkBridge = BABYLON.MeshBuilder.CreateBox(
			'forkBridge',
			{ width: 0.16, height: 0.16, depth: 0.92 },
			scene
		);
		forkBridge.parent = forksRoot;
		forkBridge.position.set(0.1, 0, 0);
		forkBridge.material = darkMetalMaterial;

		const leftFork = BABYLON.MeshBuilder.CreateBox(
			'leftFork',
			{ width: 1.25, height: 0.08, depth: 0.12 },
			scene
		);
		leftFork.parent = forksRoot;
		leftFork.position.set(0.64, -0.12, -0.22);
		leftFork.material = metalMaterial;

		const rightFork = BABYLON.MeshBuilder.CreateBox(
			'rightFork',
			{ width: 1.25, height: 0.08, depth: 0.12 },
			scene
		);
		rightFork.parent = forksRoot;
		rightFork.position.set(0.64, -0.12, 0.22);
		rightFork.material = metalMaterial;

		const bandRoot = new BABYLON.TransformNode('bandRoot', scene);
		const conveyor = BABYLON.MeshBuilder.CreateBox(
			'conveyor',
			{ width: 1.0, height: 0.12, depth: 4.1 },
			scene
		);
		conveyor.parent = bandRoot;
		conveyor.position.set(0, 0.06, 0);
		conveyor.material = bandMaterial;

		[-1.7, -0.55, 0.55, 1.7].forEach((z, index) => {
			const roller = BABYLON.MeshBuilder.CreateCylinder(
				`roller-${index}`,
				{ diameter: 0.18, height: 1.08, tessellation: 20 },
				scene
			);
			roller.parent = bandRoot;
			roller.position.set(0, 0.11, z);
			roller.rotation.z = Math.PI / 2;
			roller.material = frameMaterial;
		});

		const loadPackages = Array.from({ length: 3 }, (_, index) => createLoadPackage(BABYLON, `load-${index + 1}`));

		const rackRoot = new BABYLON.TransformNode('rackRoot', scene);
		const rackSpan = 5.4;
		const rackDepth = 1.5;
		const rackPostHeight = 4.6;
		const rackPostOffsets = [-2.7, -0.9, 0.9, 2.7];
		const rackFrontZ = -rackDepth / 2;
		const rackBackZ = rackDepth / 2;
		const rackBayCenters = [-1.8, 0, 1.8];

		rackPostOffsets.forEach((offset, index) => {
			const frontUpright = BABYLON.MeshBuilder.CreateBox(
				`rackFrontUpright-${index}`,
				{ width: 0.16, height: rackPostHeight, depth: 0.16 },
				scene
			);
			frontUpright.parent = rackRoot;
			frontUpright.position.set(offset, rackPostHeight / 2, rackFrontZ);
			frontUpright.material = rackFrameMaterial;

			const backUpright = BABYLON.MeshBuilder.CreateBox(
				`rackBackUpright-${index}`,
				{ width: 0.16, height: rackPostHeight, depth: 0.16 },
				scene
			);
			backUpright.parent = rackRoot;
			backUpright.position.set(offset, rackPostHeight / 2, rackBackZ);
			backUpright.material = rackFrameMaterial;
		});

		[0.7, 1.58, 2.46, 3.34].forEach((height, shelfIndex) => {
			rackBayCenters.forEach((centerX, bayIndex) => {
				const frontBeam = BABYLON.MeshBuilder.CreateBox(
					`rackFrontBeam-${shelfIndex}-${bayIndex}`,
					{ width: 1.62, height: 0.08, depth: 0.14 },
					scene
				);
				frontBeam.parent = rackRoot;
				frontBeam.position.set(centerX, height, rackFrontZ);
				frontBeam.material = rackBeamMaterial;

				const backBeam = BABYLON.MeshBuilder.CreateBox(
					`rackBackBeam-${shelfIndex}-${bayIndex}`,
					{ width: 1.62, height: 0.08, depth: 0.14 },
					scene
				);
				backBeam.parent = rackRoot;
				backBeam.position.set(centerX, height, rackBackZ);
				backBeam.material = rackBeamMaterial;
			});
		});

		[
			[-1.8, 1.18],
			[0, 1.18],
			[1.8, 1.18],
			[-1.8, 2.06],
			[0, 2.06],
			[1.8, 2.06],
			[-1.8, 2.94],
			[0, 2.94],
			[1.8, 2.94]
		].forEach(([x, y], index) => {
			const connector = BABYLON.MeshBuilder.CreateBox(
				`rackConnector-${index}`,
				{ width: 0.08, height: 0.08, depth: rackDepth + 0.04 },
				scene
			);
			connector.parent = rackRoot;
			connector.position.set(x, y, 0);
			connector.material = rackFrameMaterial;
		});

		const topCap = BABYLON.MeshBuilder.CreateBox(
			'rackTopCap',
			{ width: rackSpan, height: 0.1, depth: 0.1 },
			scene
		);
		topCap.parent = rackRoot;
		topCap.position.set(0, rackPostHeight - 0.1, 0);
		topCap.material = rackBeamMaterial;

		const bottomCap = BABYLON.MeshBuilder.CreateBox(
			'rackBottomCap',
			{ width: rackSpan, height: 0.08, depth: 0.08 },
			scene
		);
		bottomCap.parent = rackRoot;
		bottomCap.position.set(0, 0.18, 0);
		bottomCap.material = rackFrameMaterial;

		const safetyBar = BABYLON.MeshBuilder.CreateBox(
			'rackSafetyBar',
			{ width: rackSpan + 0.28, height: 0.08, depth: 0.08 },
			scene
		);
		safetyBar.parent = rackRoot;
		safetyBar.position.set(0, 0.36, 0);
		safetyBar.material = darkMetalMaterial;

		const syncScene = (state: AsrsSimulationSnapshot) => {
			frameRoot.position.set(state.asrs.position.x, state.asrs.position.y, state.asrs.position.z);
			shuttleRoot.position.set(
				state.asrs.shuttlePosition.x - state.asrs.position.x,
				0,
				state.asrs.shuttlePosition.z - state.asrs.position.z
			);
			carriageRoot.position.y = state.asrs.carriageHeight;
			forksRoot.position.set(0.72 + (state.asrs.forkExtension - 0.24) * 0.35, -0.34, 0);
			rackRoot.position.set(state.rack.position.x, state.rack.position.y, state.rack.position.z);
			bandRoot.position.set(state.track.position.x, state.track.position.y, state.track.position.z);

			state.loads.forEach((load, index) => {
				const packageHandle = loadPackages[index];
				const isDelivered = index < state.deliveredLoads.length;
				const isActive = index === state.deliveredLoads.length && !state.completed;
				const isCarried = isActive && state.carryingLoad;

				packageHandle.root.setEnabled(true);
				packageHandle.root.parent = isCarried ? forksRoot : null;
				if (isCarried) {
					packageHandle.root.position.set(
						carriedLoadOffset.x,
						carriedLoadOffset.y,
						carriedLoadOffset.z
					);
				} else {
					packageHandle.root.position.set(
						load.pallet.position.x,
						load.pallet.position.y,
						load.pallet.position.z
					);
				}
				packageHandle.root.rotation.y = isDelivered ? Math.PI / 2 : 0;
			});

			statusMessage = phaseLabels[state.phase];
			summaryText = controller.summary;
		};

		return {
			engine,
			scene,
			frameRoot,
			shuttleRoot,
			carriageRoot,
			forksRoot,
			rackRoot,
			bandRoot,
			loadPackages,
			syncScene,
			dispose: () => {
				scene.dispose();
				engine.dispose();
			}
		};
	}

	onMount(() => {
		let disposed = false;
		let handles: SceneHandles | null = null;
		let resizeHandler: (() => void) | null = null;
		let telemetryTimer: number | null = null;

		void (async () => {
			try {
				const BABYLON = await import('babylonjs');
				if (!canvas || disposed) {
					return;
				}

				handles = createScene(BABYLON as BabylonModule);
				refreshState();
				handles.syncScene(snapshot);
				connectTelemetryPublisher();
				connectControlSubscriber();
				publishTelemetryFrame();
				telemetryTimer = window.setInterval(() => {
					publishTelemetryFrame();
				}, 500);
				ready = true;
				statusMessage = 'Escena lista';

				let previousTime = performance.now();
				const renderLoop = () => {
					if (!handles) {
						return;
					}

					const currentTime = performance.now();
					const dt = (currentTime - previousTime) / 1000;
					previousTime = currentTime;

					if (!isPaused) {
						controller.update(dt * speedMultiplier);
					}

					refreshState();
					handles.syncScene(snapshot);
					handles.scene.render();
				};

				handles.engine.runRenderLoop(renderLoop);
				resizeHandler = () => handles?.engine.resize();
				window.addEventListener('resize', resizeHandler);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				errorMessage = `No se pudo iniciar BabylonJS: ${message}`;
			}
		})();

		return () => {
			disposed = true;
			if (telemetryTimer !== null) {
				window.clearInterval(telemetryTimer);
			}
			if (resizeHandler) {
				window.removeEventListener('resize', resizeHandler);
			}
			telemetryPublisher.disconnect();
			controlSubscriber.disconnect();
			handles?.dispose();
		};
	});
</script>

<svelte:head>
	<title>ASRS</title>
	<meta
		name="description"
		content="Escena 3D del ASRS con máquina fija, banda de entrada y shuttle cartesiano."
	/>
</svelte:head>

<section class="min-h-screen bg-slate-950 px-6 pt-6 pb-6 text-slate-100">
	<div class="mx-auto max-w-7xl">
		<header class="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px] lg:items-start">
			<div>
				<h1 class="mb-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl">
					ASRS
				</h1>
				<p class="max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
					Simulación 3D de un ASRS fijo junto al rack. El shuttle cartesiano toma 3 pallets desde la
					banda de entrada y los guarda en el primer nivel del rack.
				</p>
			</div>

			<div class="rounded-2xl border border-slate-500/20 bg-slate-900/80 p-4 shadow-xl shadow-black/20">
				<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Estado</p>
				<p class="mt-1 text-lg font-semibold text-white">{statusMessage}</p>
				<p class="mt-1 text-sm wrap-break-word text-slate-300">{summaryText}</p>
			</div>
		</header>

		<div class="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_360px]">
			<div
				class="overflow-hidden rounded-3xl border border-slate-500/20 bg-slate-900/80 shadow-xl shadow-black/20"
			>
				<div class="flex flex-col gap-3 px-4 pt-4">
					<div class="flex flex-wrap gap-2">
						<span
							class={`rounded-full border px-3 py-1 text-xs font-medium ${snapshot.autoPilot ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : 'border-slate-500/20 bg-slate-800/80 text-slate-100'}`}
						>
							{snapshot.autoPilot ? 'Auto demo activo' : 'Modo manual'}
						</span>
						<span
							class={`rounded-full border px-3 py-1 text-xs font-medium ${snapshot.carryingLoad ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : 'border-slate-500/20 bg-slate-800/80 text-slate-100'}`}
						>
							{snapshot.carryingLoad ? 'Cargando caja' : 'Caja en reposo'}
						</span>
						<span
							class={`rounded-full border px-3 py-1 text-xs font-medium ${snapshot.completed ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : 'border-slate-500/20 bg-slate-800/80 text-slate-100'}`}
						>
							{snapshot.completed ? 'Secuencia completada' : 'Secuencia en curso'}
						</span>
					</div>

					{#if errorMessage}
						<div class="rounded-2xl border border-rose-400/35 bg-rose-950/40 p-3 text-sm text-rose-100">
							{errorMessage}
						</div>
					{/if}
				</div>

				<canvas bind:this={canvas} class="mt-4 block h-160 w-full bg-slate-950 md:h-175"></canvas>

				<div
					class="grid gap-3 border-t border-slate-500/20 bg-slate-950/40 px-4 py-4 sm:grid-cols-3"
				>
					<div>
						<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Shuttle</p>
						<p class="mt-1 text-sm font-medium text-white">
							{formatVector3(snapshot.asrs.shuttlePosition)}
						</p>
					</div>
					<div>
						<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Carro</p>
						<p class="mt-1 text-sm font-medium text-white">
							{snapshot.asrs.carriageHeight.toFixed(2)} m · {snapshot.asrs.forkExtension.toFixed(2)} m
						</p>
					</div>
					<div>
						<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">
							Última actualización
						</p>
						<p class="mt-1 text-sm font-medium text-white">
							{formatTimestamp(snapshot.telemetry[0]?.receivedAt ?? new Date().toISOString())}
						</p>
					</div>
				</div>
			</div>

			<aside
				class="grid gap-4 rounded-3xl border border-slate-500/20 bg-slate-900/80 p-4 shadow-xl shadow-black/20"
			>
				<div>
					<h2 class="text-lg font-semibold text-white">Controles</h2>
					<p class="mt-1 text-sm text-slate-300">
						Usa estos comandos para observar la banda, el shuttle cartesiano y el rack.
					</p>
					<p class="mt-2 text-xs font-medium text-sky-200">{telemetryStatus}</p>
					<p class="mt-1 text-xs font-medium text-sky-100">{controlStatus}</p>
					<p class="mt-1 text-xs font-medium text-emerald-200">{animationStatus}</p>
				</div>

				<div class="flex flex-wrap gap-3">
					<button
						type="button"
						class="rounded-full bg-linear-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
						onclick={startDemo}
					>
						Iniciar demo
					</button>
					<button
						type="button"
						class="rounded-full border border-slate-500/25 bg-slate-800/80 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-sky-400/60"
						onclick={stopDemo}
					>
						Pausar demo
					</button>
					<button
						type="button"
						class="rounded-full border border-slate-500/25 bg-slate-800/80 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-sky-400/60"
						onclick={resetScene}
					>
						Reiniciar
					</button>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div class="rounded-2xl border border-slate-500/20 bg-slate-950/60 p-3">
						<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Fase</p>
						<p class="mt-1 text-sm font-medium text-white">{snapshot.phase}</p>
					</div>
					<div class="rounded-2xl border border-slate-500/20 bg-slate-950/60 p-3">
						<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Carga</p>
						<p class="mt-1 text-sm font-medium text-white">
							{Math.min(snapshot.activeLoadIndex, snapshot.totalLoads - 1) + 1}/{snapshot.totalLoads}
						</p>
					</div>
					<div class="rounded-2xl border border-slate-500/20 bg-slate-950/60 p-3">
						<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Pallet</p>
						<p class="mt-1 text-sm font-medium text-white">
							{formatDimensions3D(snapshot.pallet.dimensions)}
						</p>
					</div>
					<div class="rounded-2xl border border-slate-500/20 bg-slate-950/60 p-3">
						<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Rack</p>
						<p class="mt-1 text-sm font-medium text-white">
							{formatVector3(snapshot.rack.position)}
						</p>
					</div>
				</div>

				<div class="rounded-2xl border border-slate-500/20 bg-slate-950/60 p-4">
					<h3 class="text-sm font-semibold tracking-[0.14em] text-slate-400 uppercase">
						Contexto textual visible
					</h3>
					<p class="mt-2 text-sm text-slate-200">{summaryText}</p>
					<p class="mt-2 text-sm text-slate-300">
						La telemetría sale por websocket para que el panel textual pueda leer la banda, el
						shuttle cartesiano y el rack por separado.
					</p>
				</div>

				{#if ready}
					<div
						class="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 p-3 text-sm text-emerald-100"
					>
						Escena renderizando y sincronizada con el registro de telemetría.
					</div>
				{/if}
			</aside>
		</div>
	</div>
</section>
