# 🚀 VTS Orbiter — VTubeStudio API Demo App  
> A basic API to get VTS API working

VTS Orbiter is a Node.js plugin that automatically copies a PNG into VTube Studio’s `Items` folder, spawns it into the scene, and makes it **orbit the model’s head in real time** using the official WebSocket API.

No manual dragging. No fiddling with transform controls.  
Just plug in an image → watch it begin its celestial journey. 🌙✨

---

## 🧠 Features

### 🌀 **Dynamic Orbiting**
Your item animates around the model’s head using customizable:
- Radius  
- Speed  
- Rotation math  
- Offset from head position  

Smooth 33ms updates give it an organic, lively feel.

### 📦 **Automatic Asset Deployment**
Place your PNG inside `/public` and the script will:
1. Detect your VTube Studio installation path (Steam defaults supported)  
2. Copy the asset into VTS’s `Items` directory  
3. Load it automatically on startup  

### 🔗 **WebSocket API Integration**
The plugin speaks full VTS protocol:
- Authentication token creation + caching  
- Automatic reconnect  
- Session state checks  
- ItemLoad, ItemMove, ItemPin, and more  

### 🎯 **Model Head Tracking**
The plugin subscribes to `ModelMovedEvent` and continuously syncs:
- Model X/Y
- Rotation
- Size  

This ensures the orbit stays glued to your avatar’s head, even during movement.

### 🧹 **Graceful Exit**
Press:
- `q` – Quit properly  
- `Ctrl+C` – Also works  

On exit:
- Items loaded by this plugin are safely unloaded  
- WebSocket is closed  
- Terminal state is restored  

---

## 📁 Project Structure

```
.
├── index.js
├── package.json
├── auth_token.txt
├── public/
│   └── orbiter.png
└── README.md
```

---

## 🛠️ Installation

### 1. Clone or download the project
```bash
git clone https://github.com/orokro/vts-orbiter.git
cd vts-orbiter
```

### 2. Install dependencies
```bash
npm install
```

### 3. Add your image
Place your PNG (e.g., `cookie.png`) inside:

```
/public
```

---

## ▶️ Usage

### Run with default `orbiter.png`
```bash
npm start
```

### Run with a custom asset
```bash
node index.js cookie.png
```

### While running:
- VTS will prompt you to approve the new plugin (first run only)
- Your image will appear and begin orbiting automatically
- Press `q` to gracefully exit

---

## ⚙️ Configuration Overview

Inside `index.js`, you’ll find key tweakables:

### Orbit Settings
```js
const baseRadius = 0.18;
const headOffsetX = 0;
const headOffsetY = 0.75;
const speed = 0.35;
```

### ArtMesh Pinning (optional)
```js
const HEAD_ARTMESH_ID = "ArtMesh51";
```
Note: if pinned, it doesn't orbit. It can only orbit if it's free in the scene.
Because of this the tracking follows the model, but not the head art mesh.


### Auto-detection of VTS path
```js
findVTubeStudioPath();
```

---

## 🔐 Authentication

Your VTS authentication token is saved to:
```
auth_token.txt
```

Delete it if you want to reset plugin permissions.

---

## 🧩 API Endpoints Used

This plugin implements:

- APIStateRequest  
- AuthenticationTokenRequest  
- AuthenticationRequest  
- EventSubscriptionRequest  
- ItemLoadRequest  
- ItemMoveRequest  
- ItemPinRequest  
- ItemUnloadRequest  

---

## 🧠 How the Orbiting Works

Each frame (~33ms):
1. Angle increases  
2. New X/Y via sin/cos  
3. Rotation derived  
4. `ItemMoveRequest` updates the item  

```js
sendRequest("ItemMoveRequest", {
	itemsToMove: [{
		itemInstanceID: itemInstanceId,
		timeInSeconds: 0.1,
		positionX: newX,
		positionY: newY,
		rotation,
		fadeMode: "linear",
		userCanStop: true
	}]
});
```

---

## 🚨 Troubleshooting

### ❌ “File not found in public folder”
Place your PNG inside `/public`.

### ❌ “Could not auto-detect VTube Studio installation path”
Install VTS in a standard Steam library or adjust `findVTubeStudioPath()`.
Or add the path in the array to check.

### ❌ No item appears
- Ensure VTS API access is enabled  
- Check VTS logs  
- Confirm file copied to `Items` folder  
