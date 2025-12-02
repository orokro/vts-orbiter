/*
	index.js
	--------

	A Node.js application that connects to VTube Studio via WebSocket,
	loads a specified image asset, and makes it orbit around the screen.
*/

const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');

// --- Configuration ---
const VTS_PORT = 8001;
const VTS_URL = `ws://localhost:${VTS_PORT}`;
const PLUGIN_NAME = "NodeOrbiter";
const PLUGIN_DEVELOPER = "NodeJS User";
const TOKEN_FILE = './auth_token.txt';
const PUBLIC_FOLDER = path.join(__dirname, 'public');

let modelPosition = {
	x: 0,
	y: 0,
	rotation: 0,
	size: 1
};

// ArtMesh ID to pin the cookie to (something that moves with your head)
const HEAD_ARTMESH_ID = "ArtMesh51";

// --- Runtime Arguments ---
// Usage: node index.js [filename.png]
// Defaults to "orbiter.png" if no argument provided
const TARGET_FILENAME = process.argv[2] || "orbiter.png";

// --- State ---
let ws = null;
let keepAliveTimer = null;
let orbitTimer = null;
let authToken = null;
let itemInstanceId = null;
let requestCounter = 0;
let angle = 0;

// Load existing token if available
if (fs.existsSync(TOKEN_FILE)) {
	authToken = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
}

// --- File System Logic (The "Throwing" Part) ---


/**
 * Helper function to find VTube Studio's installation path.
 * 
 * @returns {string|null} The path to VTube Studio's Items folder, or null if not found.
 */
function findVTubeStudioPath() {

	const platform = os.platform();
	const homeDir = os.homedir();
	
	// Common installation paths to check
	const commonPaths = [];

	// Add platform-specific common paths
	if (platform === 'win32') {
		commonPaths.push(
			'C:\\Program Files (x86)\\Steam\\steamapps\\common\\VTube Studio\\VTube Studio_Data\\StreamingAssets\\Items',
			'C:\\Program Files\\Steam\\steamapps\\common\\VTube Studio\\VTube Studio_Data\\StreamingAssets\\Items',
			'D:\\Steam\\steamapps\\common\\VTube Studio\\VTube Studio_Data\\StreamingAssets\\Items',
			'D:\\SteamLibrary\\steamapps\\common\\VTube Studio\\VTube Studio_Data\\StreamingAssets\\Items',
		);
	} else if (platform === 'darwin') {
		commonPaths.push(
			'/Applications/VTube Studio.app/Contents/Resources/Data/StreamingAssets/Items',
			path.join(homeDir, 'Library/Application Support/Steam/steamapps/common/VTube Studio/VTube Studio_Data/StreamingAssets/Items')
		);
	}

	// Check each common path & return the first that exists
	for (const p of commonPaths)
		if (fs.existsSync(p))
			return p;
		
	// return null if none found
	return null;
}



/**
 * Prepares the asset by checking its existence and copying it to VTube Studio's Items folder.
 */
function prepareAsset() {

	console.log(`[Setup] Preparing to load: ${TARGET_FILENAME}`);

	// 1. Check if file exists in our local 'public' folder
	const localPath = path.join(PUBLIC_FOLDER, TARGET_FILENAME);
	if (!fs.existsSync(localPath)) {
		console.error(`[Error] File not found in public folder: ${localPath}`);
		console.error(`Please create a 'public' folder and put '${TARGET_FILENAME}' inside it.`);
		process.exit(1);
	}

	// 2. Find VTube Studio
	const vtsItemsPath = findVTubeStudioPath();
	if (!vtsItemsPath) {
		console.error("[Error] Could not auto-detect VTube Studio installation path.");
		console.error("Please ensure VTube Studio is installed in a standard Steam library location.");
		process.exit(1);
	}

	// 3. Copy the file
	const destPath = path.join(vtsItemsPath, TARGET_FILENAME);
	try {
		console.log(`[Setup] Copying asset to: ${vtsItemsPath}`);
		fs.copyFileSync(localPath, destPath);
		console.log("[Setup] Asset copied successfully.");
	} catch (err) {
		console.error(`[Error] Failed to copy asset: ${err.message}`);
		process.exit(1);
	}
}


// --- Main Connection Logic ---


/**
 * Establishes a WebSocket connection to VTube Studio and sets up event handlers.
 */
function connect() {

	if (ws) {
		ws.removeAllListeners();
		try { ws.terminate(); } catch (e) {}
	}

	console.log(`[Connect] Connecting to VTS @ ${VTS_URL}...`);
	ws = new WebSocket(VTS_URL);

	ws.on('open', () => {
		console.log("[Connect] Connected.");
		startAuthFlow();
	});

	ws.on('message', (data) => {
		try {
			handleResponse(JSON.parse(data));
		} catch (e) {
			console.error("[Error] Parse failed:", e);
		}
	});

	ws.on('error', (err) => console.error(`[Error] Socket: ${err.message}`));
	
	ws.on('close', () => {
		console.warn("[Connect] Disconnected. Retrying in 2s...");
		cleanupState();
		setTimeout(connect, 2000);
	});
}


/**
 * Cleans up timers and state on disconnection.
 */
function cleanupState() {

	if (orbitTimer) 
		clearInterval(orbitTimer);

	if (keepAliveTimer) 
		clearInterval(keepAliveTimer);

	orbitTimer = null;
	keepAliveTimer = null;
	itemInstanceId = null;
}


// --- Protocol Helper ---

function sendRequest(messageType, data = {}) {
	if (!ws || ws.readyState !== WebSocket.OPEN) return;
	const requestID = `req_${requestCounter++}`;
	ws.send(JSON.stringify({
		apiName: "VTubeStudioPublicAPI",
		apiVersion: "1.0",
		requestID, messageType, data
	}));
}

// --- Response Handler ---

function handleResponse(res) {

	if (res.messageType === "APIError") {
		// Ignore "InstanceID not found" errors during cleanup
		if (res.data.errorID !== 50) console.error(`[API Error] ${res.data.message}`);
		return;
	}

	switch (res.messageType) {
		case "APIStateResponse":
			res.data.currentSessionAuthenticated ? loadItem() : requestToken();
			break;

		case "AuthenticationTokenResponse":
			authToken = res.data.authenticationToken;
			fs.writeFileSync(TOKEN_FILE, authToken);
			console.log("[Auth] Token saved.");
			authenticate();
			break;

		case "AuthenticationResponse":

			if (res.data.authenticated) {
				console.log("[Auth] Authenticated.");
		
				// Subscribe to model movement updates
				sendRequest("EventSubscriptionRequest", {
					eventName: "ModelMovedEvent",
					subscribe: true,
					config: {
						// empty or default config is fine
					}
				});
		
				loadItem();
			} else {
				console.error("[Auth] Failed. Delete auth_token.txt to reset.");
			}
			break;

		case "ModelMovedEvent":
			// return;
			if (res.data && res.data.modelPosition) {
				console.log("[Model] Pos:", res.data); // debug if you want

				const {positionX, positionY, rotation, size} = res.data.modelPosition;
				
				modelPosition.x = positionX;
				modelPosition.y = positionY;
				modelPosition.rotation = rotation;
				modelPosition.size = size;
				
			}
			break;

		case "ItemLoadResponse":
			itemInstanceId = res.data.instanceID;
			console.log(`[Item] Loaded successfully (ID: ${itemInstanceId})`);
			// NEW: pin to head instead of starting orbit directly
			// pinItemToHead();
			startOrbitLoop();
			break;

		case "ItemPinResponse":
			if (res.data.isPinned) {
				console.log("[Pin] Item pinned to model. Starting orbit.");
			} else {
				console.warn("[Pin] ItemPinRequest reported not pinned, starting orbit anyway.");
			}
			startOrbitLoop();
			break;
	}
}

// --- Logic Flows ---

function startAuthFlow() { sendRequest("APIStateRequest"); }

function requestToken() {
	if (authToken) authenticate();
	else {
		console.log("[Auth] Check VTube Studio to approve plugin...");
		sendRequest("AuthenticationTokenRequest", { pluginName: PLUGIN_NAME, pluginDeveloper: PLUGIN_DEVELOPER });
	}
}


function authenticate() {
	sendRequest("AuthenticationRequest", { pluginName: PLUGIN_NAME, pluginDeveloper: PLUGIN_DEVELOPER, authenticationToken: authToken });
}


/**
 * Sends a request to load the specified item into VTube Studio.
 */
function loadItem() {

	console.log(`[Item] Spawning '${TARGET_FILENAME}' in VTS...`);

	sendRequest("ItemLoadRequest", {
		fileName: TARGET_FILENAME,
		positionX: 0,
		positionY: 0,
		size: 0.1,
		animationPlayState: true,
		useAutoFit: true,
		customData: "NodeJS_Orbit_Item"
	});
}


/**
 * Pin the loaded item to the model's head ArtMesh so it follows the model.
 */
function pinItemToHead() {

	if (!itemInstanceId) {
		console.warn("[Pin] No itemInstanceId yet, can't pin.");
		return;
	}

	if (!HEAD_ARTMESH_ID) {
		console.warn("[Pin] HEAD_ARTMESH_ID not set, skipping pin.");
		startOrbitLoop();
		return;
	}

	console.log("[Pin] Pinning item to head ArtMesh...");

	sendRequest("ItemPinRequest", {
		pin: true,
		itemInstanceID: itemInstanceId,
		angleRelativeTo: "RelativeToModel",
		sizeRelativeTo: "RelativeToCurrentItemSize",
		vertexPinType: "Center",
		pinInfo: {
			// leave modelID empty to use current model
			modelID: "",
			artMeshID: HEAD_ARTMESH_ID,
			angle: 0,	// keep current rotation
			size: 0		// keep current size
		}
	});
}


function startOrbitLoop() {

	// gtfo if already running
	if (orbitTimer)
		return;

	console.log("[Orbit] Orbiting...");

	const baseRadius = 0.18;	// small circle around the head
	const headOffsetX = 0;		// tweak these to line up with your head
	const headOffsetY = 0.75;

	const speed = 0.35;

	orbitTimer = setInterval(() => {
		if (!itemInstanceId) return;

		angle += speed;

		// For now, ignore modelPosition.size in the math so we don't yeet it off-screen
		const centerX = modelPosition.x + headOffsetX;
		const centerY = modelPosition.y + headOffsetY;

		const radius = baseRadius; // do NOT multiply by modelPosition.size yet

		const newX = centerX + Math.cos(angle) * radius;
		const newY = centerY + Math.sin(angle) * radius * 0.5;

		// radians -> degrees, keep it sane
		let angleDeg = (angle * 180 / Math.PI) % 360;
		if (angleDeg > 180) angleDeg -= 360;
		const rotation = -angleDeg;

		// quick debug if you want:
		// console.log("orbit pos:", { newX, newY });

		sendRequest("ItemMoveRequest", {
			itemsToMove: [{
				itemInstanceID: itemInstanceId,
				timeInSeconds:0.1,
				fadeMode: "linear",
				positionX: newX,
				positionY: newY,
				size: -1000,
				rotation,
				order: -1000,
				setFlip: false,
				flip: false,
				userCanStop: true
			}]
		});
	}, 33);
}




/**
 * Allows the user to exit the application gracefully using 'q' or Ctrl+C.
 * 
 * @returns {void}
 */
function setupExitControls() {
	if (!process.stdin.isTTY) return;

	process.stdin.setRawMode(true);
	process.stdin.resume();

	process.stdin.setEncoding('utf8');

	console.log("[Controls] Press 'q' or Ctrl+C to quit.");

	process.stdin.on('data', (key) => {
		if (key === '\u0003') return gracefulExit();	// Ctrl+C
		if (key.toLowerCase() === 'q') return gracefulExit();
	});
}


/**
 * Cleans up resources and exits the application gracefully.
 */
function gracefulExit() {
	console.log("\n[Exit] Cleaning up…");

	// unload item from VTS
	sendRequest("ItemUnloadRequest", {
		unloadAllLoadedByThisPlugin: true
	});

	// remove the cookie file from VTS Items folder

	if (fs.existsSync(assetPath)) {
		try { fs.unlinkSync(assetPath); } catch (e) {}
	}

	if (ws && ws.readyState === WebSocket.OPEN)
		ws.close();

	process.stdin.setRawMode(false);
	process.stdin.pause();

	setTimeout(() => process.exit(0), 200);
}



// --- Start ---
console.log("--- VTube Studio Node Orbiter ---");

// 1. Prepare file
prepareAsset();

// 2. Allow exit controls
setupExitControls();

// 3. Connect
connect();
