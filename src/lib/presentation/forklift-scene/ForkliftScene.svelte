<script lang="ts">
	import { onMount } from 'svelte';

	import { createForkliftSceneController } from '$lib/application/forklift-scene-controller';
	import type { ForkliftSimulationSnapshot } from '$lib/domain/forklift-simulation';
	import { formatDimensions3D, formatTimestamp, formatVector3 } from '$lib/domain/model-telemetry';
	import { formatSceneControlLabel, parseSceneControlMessage } from '$lib/domain/scene-control';
	import { ModelTelemetrySocketClient } from '$lib/infrastructure/websocket/model-telemetry-socket';

	type BabylonModule = typeof import('babylonjs');
	type SceneHandles = {
		engine: {
			runRenderLoop: (callback: () => void) => void;
			resize: () => void;
			dispose: () => void;
		};
		scene: { render: () => void; dispose: () => void };
		forkliftRoot: {
			position: { set: (x: number, y: number, z: number) => void };
			rotation: { y: number };
		};
		forkCarriage: { position: { y: number } };
		palletRoot: {
			position: { set: (x: number, y: number, z: number) => void };
			rotation: { y: number };
		};
		boxesRoot: {
			position: { set: (x: number, y: number, z: number) => void };
			rotation: { y: number };
		};
		rackRoot: {
			position: { set: (x: number, y: number, z: number) => void };
			rotation: { y: number };
		};
		syncScene: (state: ForkliftSimulationSnapshot) => void;
		dispose: () => void;
	};

	const controller = createForkliftSceneController();
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

	const phaseLabels: Record<ForkliftSimulationSnapshot['phase'], string> = {
		idle: 'Inactivo',
		'approach-pallet': 'Aproximándose a la caja',
		'insert-forks': 'Insertando paletas',
		'lift-pallet': 'Levantando caja',
		'travel-to-rack': 'Transportando al rack',
		'place-pallet': 'Colocando caja',
		'return-to-pallet': 'Regresando por la caja',
		complete: 'Demostración completada'
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

	function moveForward(): void {
		controller.moveForward();
		refreshState();
	}

	function moveBackward(): void {
		controller.moveBackward();
		refreshState();
	}

	function turnLeft(): void {
		controller.turnLeft();
		refreshState();
	}

	function turnRight(): void {
		controller.turnRight();
		refreshState();
	}

	function raiseForks(): void {
		controller.raiseForks();
		refreshState();
	}

	function lowerForks(): void {
		controller.lowerForks();
		refreshState();
	}

	function formatVectorLabel(value: { x: number; y: number; z: number }): string {
		return `${formatVector3(value)} · y=${value.y.toFixed(2)}`;
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

	function createScene(BABYLON: BabylonModule): SceneHandles {
		const engine = new BABYLON.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true });
		const scene = new BABYLON.Scene(engine);
		scene.clearColor = new BABYLON.Color4(0.04, 0.08, 0.16, 1);

		const camera = new BABYLON.ArcRotateCamera(
			'forkliftCamera',
			-Math.PI / 2.35,
			Math.PI / 3.25,
			22,
			new BABYLON.Vector3(2, 1.4, 0),
			scene
		);
		camera.attachControl(canvas, true);
		camera.lowerRadiusLimit = 10;
		camera.upperRadiusLimit = 34;
		camera.wheelPrecision = 35;
		camera.panningSensibility = 70;

		const hemiLight = new BABYLON.HemisphericLight(
			'hemiLight',
			new BABYLON.Vector3(0, 1, 0),
			scene
		);
		hemiLight.intensity = 1.1;
		hemiLight.groundColor = new BABYLON.Color3(0.16, 0.18, 0.24);

		const dirLight = new BABYLON.DirectionalLight(
			'dirLight',
			new BABYLON.Vector3(-0.3, -1, -0.45),
			scene
		);
		dirLight.position = new BABYLON.Vector3(14, 24, 10);
		dirLight.intensity = 1.6;

		const ground = BABYLON.MeshBuilder.CreateGround(
			'ground',
			{ width: 42, height: 20, subdivisions: 2 },
			scene
		);
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

		const metalMaterial = new BABYLON.StandardMaterial('metalMaterial', scene);
		metalMaterial.diffuseColor = new BABYLON.Color3(0.28, 0.31, 0.38);
		metalMaterial.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		const darkMetalMaterial = new BABYLON.StandardMaterial('darkMetalMaterial', scene);
		darkMetalMaterial.diffuseColor = new BABYLON.Color3(0.12, 0.14, 0.18);
		darkMetalMaterial.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		const glassMaterial = new BABYLON.StandardMaterial('glassMaterial', scene);
		glassMaterial.diffuseColor = new BABYLON.Color3(0.26, 0.5, 0.7);
		glassMaterial.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);
		glassMaterial.emissiveColor = new BABYLON.Color3(0.05, 0.08, 0.12);
		glassMaterial.alpha = 0.45;

		const woodMaterial = new BABYLON.StandardMaterial('woodMaterial', scene);
		woodMaterial.diffuseColor = new BABYLON.Color3(0.58, 0.42, 0.22);
		woodMaterial.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		const palletMaterial = new BABYLON.StandardMaterial('palletMaterial', scene);
		palletMaterial.diffuseColor = new BABYLON.Color3(0.54, 0.36, 0.2);
		palletMaterial.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		const boxMaterialA = new BABYLON.StandardMaterial('boxMaterialA', scene);
		boxMaterialA.diffuseColor = new BABYLON.Color3(0.88, 0.55, 0.21);
		boxMaterialA.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		const boxMaterialB = new BABYLON.StandardMaterial('boxMaterialB', scene);
		boxMaterialB.diffuseColor = new BABYLON.Color3(0.8, 0.36, 0.33);
		boxMaterialB.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		const boxMaterialC = new BABYLON.StandardMaterial('boxMaterialC', scene);
		boxMaterialC.diffuseColor = new BABYLON.Color3(0.37, 0.66, 0.8);
		boxMaterialC.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		const boxMaterials = [boxMaterialA, boxMaterialB, boxMaterialC];

		type LoadPackage = {
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

		function createLoadPackage(prefix: string): LoadPackage {
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

			const palletSlatOffsets = [-0.42, 0, 0.42];
			palletSlatOffsets.forEach((offset, index) => {
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

			const boxMeshes = [
				BABYLON.MeshBuilder.CreateBox(`${prefix}-box-1`, { width: 0.42, height: 0.42, depth: 0.34 }, scene),
				BABYLON.MeshBuilder.CreateBox(`${prefix}-box-2`, { width: 0.42, height: 0.42, depth: 0.34 }, scene)
			];
			const boxLayout = [
				[-0.18, 0.21, 0],
				[0.18, 0.21, 0]
			] as const;
			boxMeshes.forEach((mesh, index) => {
				mesh.parent = boxesRoot;
				mesh.position.set(boxLayout[index][0], boxLayout[index][1], boxLayout[index][2]);
				mesh.material = boxMaterials[index % boxMaterials.length];
			});

			return {
				root,
				palletRoot,
				boxesRoot
			};
		}

		function toForkliftLocalPosition(
			world: { x: number; y: number; z: number },
			forklift: { x: number; y: number; z: number },
			rotationY: number
		): { x: number; y: number; z: number } {
			const deltaX = world.x - forklift.x;
			const deltaZ = world.z - forklift.z;
			const inverseRotation = -rotationY;
			const cos = Math.cos(inverseRotation);
			const sin = Math.sin(inverseRotation);

			return {
				x: deltaX * cos - deltaZ * sin,
				y: world.y - forklift.y,
				z: deltaX * sin + deltaZ * cos
			};
		}

		const rackMaterial = new BABYLON.StandardMaterial('rackMaterial', scene);
		rackMaterial.diffuseColor = new BABYLON.Color3(0.18, 0.2, 0.24);
		rackMaterial.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		const rackFrameMaterial = new BABYLON.StandardMaterial('rackFrameMaterial', scene);
		rackFrameMaterial.diffuseColor = new BABYLON.Color3(0.54, 0.58, 0.62);
		rackFrameMaterial.specularColor = new BABYLON.Color3(0.18, 0.18, 0.18);

		const rackBeamMaterial = new BABYLON.StandardMaterial('rackBeamMaterial', scene);
		rackBeamMaterial.diffuseColor = new BABYLON.Color3(0.95, 0.45, 0.16);
		rackBeamMaterial.specularColor = new BABYLON.Color3(0.16, 0.16, 0.16);

		const forkliftRoot = new BABYLON.TransformNode('forkliftRoot', scene);
		const forkliftBody = BABYLON.MeshBuilder.CreateBox(
			'forkliftBody',
			{ width: 2.65, height: 0.95, depth: 1.55 },
			scene
		);
		forkliftBody.parent = forkliftRoot;
		forkliftBody.position.y = 0.78;
		forkliftBody.material = metalMaterial;

		const forkliftCounterweight = BABYLON.MeshBuilder.CreateBox(
			'forkliftCounterweight',
			{ width: 0.55, height: 0.82, depth: 1.45 },
			scene
		);
		forkliftCounterweight.parent = forkliftRoot;
		forkliftCounterweight.position.set(-1.0, 0.74, 0);
		forkliftCounterweight.material = darkMetalMaterial;

		const cabin = BABYLON.MeshBuilder.CreateBox(
			'cabin',
			{ width: 1.1, height: 1.3, depth: 1.2 },
			scene
		);
		cabin.parent = forkliftRoot;
		cabin.position.set(-0.1, 1.38, 0);
		cabin.material = glassMaterial;

		const seat = BABYLON.MeshBuilder.CreateBox(
			'seat',
			{ width: 0.4, height: 0.22, depth: 0.42 },
			scene
		);
		seat.parent = forkliftRoot;
		seat.position.set(-0.15, 0.72, 0);
		seat.material = darkMetalMaterial;

		const mastLeft = BABYLON.MeshBuilder.CreateBox(
			'mastLeft',
			{ width: 0.12, height: 1.85, depth: 0.12 },
			scene
		);
		mastLeft.parent = forkliftRoot;
		mastLeft.position.set(1.08, 0.93, -0.52);
		mastLeft.material = darkMetalMaterial;

		const mastRight = mastLeft.clone('mastRight');
		if (mastRight) {
			mastRight.parent = forkliftRoot;
			mastRight.position.set(1.08, 0.93, 0.52);
			mastRight.material = darkMetalMaterial;
		}

		const carriage = BABYLON.MeshBuilder.CreateBox(
			'carriage',
			{ width: 0.22, height: 1.2, depth: 1.1 },
			scene
		);
		carriage.parent = forkliftRoot;
		carriage.position.set(1.22, 0.92, 0);
		carriage.material = darkMetalMaterial;

		const forkCarriage = new BABYLON.TransformNode('forkCarriage', scene);
		forkCarriage.parent = forkliftRoot;
		forkCarriage.position.set(1.28, 0.18, 0);

		const forkSupport = BABYLON.MeshBuilder.CreateBox(
			'forkSupport',
			{ width: 0.16, height: 0.16, depth: 1.0 },
			scene
		);
		forkSupport.parent = forkCarriage;
		forkSupport.position.set(0.22, 0.0, 0);
		forkSupport.material = darkMetalMaterial;

		const leftFork = BABYLON.MeshBuilder.CreateBox(
			'leftFork',
			{ width: 1.6, height: 0.08, depth: 0.12 },
			scene
		);
		leftFork.parent = forkCarriage;
		leftFork.position.set(0.72, -0.14, -0.24);
		leftFork.material = metalMaterial;

		const rightFork = BABYLON.MeshBuilder.CreateBox(
			'rightFork',
			{ width: 1.6, height: 0.08, depth: 0.12 },
			scene
		);
		rightFork.parent = forkCarriage;
		rightFork.position.set(0.72, -0.14, 0.24);
		rightFork.material = metalMaterial;

		const wheelPositions = [
			[-0.92, 0.22, -0.72],
			[-0.92, 0.22, 0.72],
			[0.92, 0.22, -0.74],
			[0.92, 0.22, 0.74]
		] as const;
		wheelPositions.forEach(([x, y, z], index) => {
			const wheel = BABYLON.MeshBuilder.CreateCylinder(
				`wheel-${index}`,
				{ diameter: 0.46, height: 0.2, tessellation: 24 },
				scene
			);
			wheel.parent = forkliftRoot;
			wheel.position.set(x, y, z);
			wheel.rotation.z = Math.PI / 2;
			wheel.material = darkMetalMaterial;
		});

		const loadPackages = Array.from({ length: 3 }, (_, index) => createLoadPackage(`load-${index + 1}`));

		const rackRoot = new BABYLON.TransformNode('rackRoot', scene);
		const rackRotationY = Math.PI / 2;
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

		const connectorPositions = [
			[-1.8, 1.18],
			[0, 1.18],
			[1.8, 1.18],
			[-1.8, 2.06],
			[0, 2.06],
			[1.8, 2.06],
			[-1.8, 2.94],
			[0, 2.94],
			[1.8, 2.94]
		] as const;
		connectorPositions.forEach(([x, y], index) => {
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

		const syncScene = (state: ForkliftSimulationSnapshot) => {
			forkliftRoot.position.set(
				state.forklift.position.x,
				state.forklift.position.y,
				state.forklift.position.z
			);
			forkliftRoot.rotation.y = state.forklift.rotationY;
			forkCarriage.position.y = state.forklift.forkHeight;

			state.loads.forEach((load, index) => {
				const packageHandle = loadPackages[index];
				const isDelivered = index < state.deliveredLoads.length;
				const isActive = index === state.deliveredLoads.length && !state.completed;
				const isCarried = isActive && state.carryingPallet;
				const loadRotationY = isDelivered ? rackRotationY : 0;

				packageHandle.root.setEnabled(true);
				packageHandle.root.parent = isCarried ? forkliftRoot : null;
				if (isCarried) {
					const localPosition = toForkliftLocalPosition(
						load.pallet.position,
						state.forklift.position,
						state.forklift.rotationY
					);
					packageHandle.root.position.set(localPosition.x, localPosition.y, localPosition.z);
				} else {
					packageHandle.root.position.set(
						load.pallet.position.x,
						load.pallet.position.y,
						load.pallet.position.z
					);
				}
				packageHandle.root.rotation.y = loadRotationY;
			});

			rackRoot.position.set(state.rack.position.x, state.rack.position.y, state.rack.position.z);
			rackRoot.rotation.y = rackRotationY;

			statusMessage = phaseLabels[state.phase];
			summaryText = controller.summary;
		};

		return {
			engine,
			scene,
			forkliftRoot,
			forkCarriage,
			palletRoot: loadPackages[0].palletRoot,
			boxesRoot: loadPackages[0].boxesRoot,
			rackRoot,
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
		<title>Forklift</title>
		<meta
			name="description"
			content="Escena 3D con un montacargas que toma cajas y las coloca en el primer nivel de un rack."
		/>
	</svelte:head>

<section class="min-h-screen bg-slate-950 px-6 pt-6 pb-6 text-slate-100">
	<div class="mx-auto max-w-7xl">
		<header class="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_330px] lg:items-start">
			<div>
				<h1 class="mb-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl lg:text-5xl">
					Forklift
				</h1>
				<p class="max-w-3xl text-sm leading-6 text-slate-300 sm:text-base">
					Simulación 3D de un montacargas, cajas y rack. La escena publica su contexto por
					websocket y el panel textual lo consume para mantener el razonamiento visible.
				</p>
			</div>

			<div
				class="rounded-2xl border border-slate-500/20 bg-slate-900/80 p-4 shadow-xl shadow-black/20"
			>
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
							class={`rounded-full border px-3 py-1 text-xs font-medium ${snapshot.carryingPallet ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : 'border-slate-500/20 bg-slate-800/80 text-slate-100'}`}
						>
							{snapshot.carryingPallet ? 'Cargando caja' : 'Caja en reposo'}
						</span>
						<span
							class={`rounded-full border px-3 py-1 text-xs font-medium ${snapshot.completed ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100' : 'border-slate-500/20 bg-slate-800/80 text-slate-100'}`}
						>
							{snapshot.completed ? 'Secuencia completada' : 'Secuencia en curso'}
						</span>
					</div>

					{#if errorMessage}
						<div
							class="rounded-2xl border border-rose-400/35 bg-rose-950/40 p-3 text-sm text-rose-100"
						>
							{errorMessage}
						</div>
					{/if}
				</div>

				<canvas bind:this={canvas} class="mt-4 block h-160 w-full bg-slate-950 md:h-175"></canvas>

				<div
					class="grid gap-3 border-t border-slate-500/20 bg-slate-950/40 px-4 py-4 sm:grid-cols-3"
				>
					<div>
						<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Forklift</p>
						<p class="mt-1 text-sm font-medium text-white">
							{formatVectorLabel(snapshot.forklift.position)}
						</p>
					</div>
					<div>
						<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Horquillas</p>
						<p class="mt-1 text-sm font-medium text-white">
							{snapshot.forklift.forkHeight.toFixed(2)} m
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
						Usa estos comandos para observar el comportamiento del montacargas y sus submodelos.
					</p>
					<p class="mt-2 text-xs font-medium text-sky-200">{telemetryStatus}</p>
					<p class="mt-1 text-xs font-medium text-sky-100">{controlStatus}</p>
					<p class="mt-1 text-xs font-medium text-emerald-200">{animationStatus}</p>
				</div>

				<div class="flex flex-wrap gap-3">
					<button
						type="button"
						class="rounded-full bg-linear-to-r from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
						onclick={startDemo}>Iniciar demo</button
					>
					<button
						type="button"
						class="rounded-full border border-slate-500/25 bg-slate-800/80 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-sky-400/60"
						onclick={stopDemo}>Pausar demo</button
					>
					<button
						type="button"
						class="rounded-full border border-slate-500/25 bg-slate-800/80 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-sky-400/60"
						onclick={resetScene}>Reiniciar</button
					>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<button
						type="button"
						class="rounded-full border border-slate-500/25 bg-slate-800/80 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-sky-400/60"
						onclick={moveForward}>Avanzar</button
					>
					<button
						type="button"
						class="rounded-full border border-slate-500/25 bg-slate-800/80 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-sky-400/60"
						onclick={moveBackward}>Retroceder</button
					>
					<button
						type="button"
						class="rounded-full border border-slate-500/25 bg-slate-800/80 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-sky-400/60"
						onclick={turnLeft}>Girar izq.</button
					>
					<button
						type="button"
						class="rounded-full border border-slate-500/25 bg-slate-800/80 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-sky-400/60"
						onclick={turnRight}>Girar der.</button
					>
					<button
						type="button"
						class="rounded-full border border-slate-500/25 bg-slate-800/80 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-sky-400/60"
						onclick={raiseForks}>Subir paletas</button
					>
					<button
						type="button"
						class="rounded-full border border-slate-500/25 bg-slate-800/80 px-4 py-2.5 text-sm font-medium text-slate-100 transition hover:border-sky-400/60"
						onclick={lowerForks}>Bajar paletas</button
					>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div class="rounded-2xl border border-slate-500/20 bg-slate-950/60 p-3">
						<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Fase</p>
						<p class="mt-1 text-sm font-medium text-white">{snapshot.phase}</p>
					</div>
					<div class="rounded-2xl border border-slate-500/20 bg-slate-950/60 p-3">
						<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Rotación</p>
						<p class="mt-1 text-sm font-medium text-white">
							{snapshot.forklift.rotationY.toFixed(2)} rad
						</p>
					</div>
					<div class="rounded-2xl border border-slate-500/20 bg-slate-950/60 p-3">
						<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Caja activa</p>
						<p class="mt-1 text-sm font-medium text-white">
							{formatDimensions3D(snapshot.boxes.dimensions)}
						</p>
					</div>
					<div class="rounded-2xl border border-slate-500/20 bg-slate-950/60 p-3">
						<p class="text-xs font-semibold tracking-[0.14em] text-slate-400 uppercase">Rack</p>
						<p class="mt-1 text-sm font-medium text-white">
							{formatVectorLabel(snapshot.rack.position)}
						</p>
					</div>
				</div>

				<div class="rounded-2xl border border-slate-500/20 bg-slate-950/60 p-4">
					<h3 class="text-sm font-semibold tracking-[0.14em] text-slate-400 uppercase">
						Contexto textual visible
					</h3>
					<p class="mt-2 text-sm text-slate-200">{summaryText}</p>
					<p class="mt-2 text-sm text-slate-300">
						La telemetría de la escena se publica hacia el panel compartido para que puedas seguir
						la lógica sin ver el canvas.
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
